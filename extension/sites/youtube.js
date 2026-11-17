// Site adapter for www.youtube.com. Every YouTube selector the extension uses is in this file.
// A video tile is a post: on the home feed and the watch page's "up next" column it is a
// <yt-lockup-view-model>, in search results a <ytd-video-renderer> (or a <ytd-grid-video-renderer>
// in a horizontal shelf), and in a Shorts shelf a <ytm-shorts-lockup-view-model>.
// YouTube fills existing tiles with other videos, so a tile's video is read from its title link each
// time: the link's address gives the video id and its text the title, so the two always belong together.

const VIDEO_TILE_SELECTOR = [
  "yt-lockup-view-model",
  "ytd-video-renderer",
  "ytd-grid-video-renderer",
  "ytm-shorts-lockup-view-model",
].join(", ");

// The video id in a "/watch?v=<id>..." or "/shorts/<id>" link, or null for any other link.
// Ads link to an ad server instead, so they are never sent.
function videoIdFromLink(link) {
  const url = new URL(link.getAttribute("href"), location.origin);
  if (url.origin !== location.origin) {
    return null;
  }
  if (url.pathname === "/watch") {
    return url.searchParams.get("v");
  }
  if (url.pathname.startsWith("/shorts/")) {
    return url.pathname.split("/")[2];
  }
  return null;
}

function titleLink(tileElement) {
  if (tileElement.tagName === "YTD-VIDEO-RENDERER" || tileElement.tagName === "YTD-GRID-VIDEO-RENDERER") {
    return tileElement.querySelector("a#video-title[href]");
  }
  return tileElement.querySelector("h3 a[href]");
}

// Playlists and mixes are lockups too, and link to their first video; they are not one video.
function isCollection(tileElement) {
  return tileElement.querySelector('[class*="ytLockupViewModelCollection"]') !== null;
}

// [channel, description snippet] of a tile; "" for what the tile does not show. Shorts tiles show
// no channel, and only search results show a snippet.
function readChannelAndSnippet(tileElement) {
  if (tileElement.tagName === "YT-LOCKUP-VIEW-MODEL") {
    // The channel avatar is labelled "Go to channel <name>". Without an avatar, the first metadata
    // text is the channel; views and age follow it, sometimes on the same row.
    const avatarLabel = tileElement.querySelector('[aria-label^="Go to channel "]')?.getAttribute("aria-label");
    if (avatarLabel !== undefined) {
      return [avatarLabel.slice("Go to channel ".length), ""];
    }
    const firstMetadataText = tileElement.querySelector(".ytContentMetadataViewModelMetadataText");
    return [firstMetadataText?.textContent.trim() ?? "", ""];
  }
  if (tileElement.tagName === "YTM-SHORTS-LOCKUP-VIEW-MODEL") {
    return ["", ""];
  }
  const snippet = tileElement.querySelector(".metadata-snippet-text");
  return [
    tileElement.querySelector("ytd-channel-name #text")?.textContent.trim() ?? "",
    snippet?.textContent.trim() ?? "",
  ];
}

const siteAdapter = {
  platform: "youtube",

  // The video tiles under rootNode, plus the tile containing it.
  findPostElements(rootNode) {
    const found = [...rootNode.querySelectorAll(VIDEO_TILE_SELECTOR)];
    const enclosing = rootNode.closest(VIDEO_TILE_SELECTOR);
    if (enclosing !== null) {
      found.push(enclosing);
    }
    return found;
  },

  // The record sent to the server, or null for a tile that is not filled in yet, an ad, or a playlist.
  // The thumbnail is always the video's standard one, whatever size the tile shows.
  extractPost(tileElement) {
    const link = titleLink(tileElement);
    if (link === null || isCollection(tileElement)) {
      return null;
    }
    const videoId = videoIdFromLink(link);
    const title = link.getAttribute("title") || link.textContent.trim();
    if (videoId === null || title === "") {
      return null;
    }
    const [channel, snippet] = readChannelAndSnippet(tileElement);
    let text = title;
    if (snippet !== "") {
      text = title + "\n\n" + snippet;
    }
    let url = "https://www.youtube.com/watch?v=" + videoId;
    if (tileElement.tagName === "YTM-SHORTS-LOCKUP-VIEW-MODEL") {
      url = "https://www.youtube.com/shorts/" + videoId;
    }
    return {
      platform: "youtube",
      kind: "post",
      post_id: videoId,
      url: url,
      author: channel,
      community: "",
      text: text,
      image_urls: ["https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg"],
    };
  },

  // treatment is described in content/post-decoration.js. The whole tile is treated.
  applyAction(tileElement, treatment) {
    decoratePost(tileElement, treatment);
  },

  // Called by the feed watcher when the server asks for a video's transcript (sites/youtube-transcript.js).
  fetchTranscript(videoId) {
    return fetchYouTubeTranscript(videoId);
  },
};

// Hovering a tile plays a preview of the video in a separate element laid over the tile, which the
// blur does not cover. YouTube is not told about the pointer moving over a blurred tile, so it never
// starts one there.
const BLURRED_TILE_SELECTOR = '[data-brainrot-index-action="pending"], [data-brainrot-index-action="blur"]:not([data-brainrot-index-revealed])';
for (const eventType of ["mouseover", "mouseenter", "mousemove", "pointerover", "pointerenter", "pointermove"]) {
  window.addEventListener(eventType, (event) => {
    if (event.target instanceof Element && event.target.closest(BLURRED_TILE_SELECTOR) !== null) {
      event.stopImmediatePropagation();
    }
  }, true);
}
