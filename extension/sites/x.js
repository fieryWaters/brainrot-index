// Site adapter for x.com. Every X selector the extension uses is in this file.
//
// X serves two markups. The one signed-in readers get marks its parts with data-testid attributes:
// each tweet is an <article data-testid="tweet">, its text a [data-testid="tweetText"], and so on.
// The redesigned one (seen by a signed-out browser in November 2026) has no data-testid at all: each
// tweet is a plain <article>, a quoted tweet is a nested <article> inside a frame
// ([data-slot="embedded-tweet-frame"]) that names its address, and a tweet's text is the first
// element written in a language ([dir="auto"][lang]). What both share is preferred: links to
// "/<user>/status/<id>", image addresses on pbs.twimg.com, <video> elements, and the row of actions
// (role="group"). Where they differ, an <article> with a data-testid is read the first way.
//
// Each post on the home timeline, and each reply on a post's page (/<user>/status/<id>), is a tweet.

const OWN_STATUS_PATH = /^\/[^/]+\/status\/\d+$/;

// The tweets of a page: every <article> that is not a tweet quoted inside another.
function isTweet(articleElement) {
  return articleElement.parentElement.closest("article") === null;
}

function usesTestIds(tweetElement) {
  return tweetElement.hasAttribute("data-testid");
}

// A quoted tweet is a box inside the tweet that X makes clickable as a whole. In the data-testid
// markup it holds the article's second name line; in the redesign it is a frame holding an <article>.
// X never shows a quote inside a quote.
function quotedTweetElement(tweetElement) {
  if (usesTestIds(tweetElement)) {
    const nameLines = tweetElement.querySelectorAll('[data-testid="User-Name"]');
    if (nameLines.length < 2) {
      return null;
    }
    return nameLines[1].closest('div[role="link"]');
  }
  return tweetElement.querySelector('[data-slot="embedded-tweet-frame"]');
}

// The elements matching selector that belong to the tweet itself rather than to the tweet it quotes.
function ownElements(tweetElement, quotedElement, selector) {
  return [...tweetElement.querySelectorAll(selector)].filter((element) =>
    quotedElement === null || !quotedElement.contains(element));
}

// "/<user>/status/<id>" for the tweet itself, or null when it has none: a tweet still loading, or a
// promoted tweet (an ad shows "Ad" instead of a time), which is never sent. In the data-testid markup
// the tweet's own link is the one wrapping its timestamp. In the redesign it is the first link to a
// status outside the quoted tweet: the timestamp, or the photo links that come before it.
function ownStatusPath(tweetElement, quotedElement) {
  if (usesTestIds(tweetElement)) {
    const timestamp = tweetElement.querySelector('a[href*="/status/"] time');
    if (timestamp === null) {
      return null;
    }
    return timestamp.closest("a").getAttribute("href");
  }
  for (const link of ownElements(tweetElement, quotedElement, 'a[href*="/status/"]')) {
    const path = link.getAttribute("href").replace(/\/(photo|video)\/\d+$/, "");
    if (OWN_STATUS_PATH.test(path)) {
      return path;
    }
  }
  return null;
}

// The element holding a tweet's text, in either markup.
function textElementOf(tweetElement, quotedElement) {
  const selector = usesTestIds(tweetElement) ? '[data-testid="tweetText"]' : '[dir="auto"][lang]';
  return ownElements(tweetElement, quotedElement, selector)[0] ?? null;
}

// Image URLs at the best size X offers, in reading order: the tweet's photos, video and GIF
// thumbnails, those of the tweet it quotes, and the picture of a link card. They are told apart from
// avatars and emoji by their address. Photos ("/media/" URLs) come in sizes chosen by the "name"
// parameter, and "orig" is the upload. A thumbnail shown both as an <img> and as a video's poster is
// sent once.
const POST_IMAGE_PATH = /^\/(media|card_img|amplify_video_thumb|ext_tw_video_thumb|tweet_video_thumb)\//;

function imageUrls(tweetElement) {
  const urls = new Set();
  const sources = [
    ...[...tweetElement.querySelectorAll("img[src]")].map((image) => image.src),
    ...[...tweetElement.querySelectorAll('video[poster]:not([poster=""])')].map((video) => video.poster),
  ];
  for (const source of sources) {
    const url = new URL(source);
    if (url.hostname !== "pbs.twimg.com" || !POST_IMAGE_PATH.test(url.pathname)) {
      continue;
    }
    if (url.pathname.startsWith("/media/")) {
      url.searchParams.set("name", "orig");
    }
    urls.add(url.href);
  }
  return [...urls];
}

// The quoted tweet as the reader sees it: its author's handle, its text, and its address when the
// page gives it (in the data-testid markup only its photos link to it).
function quotedPost(quotedElement) {
  if (quotedElement.hasAttribute("data-href")) {
    const [, author, , statusId] = quotedElement.getAttribute("data-href").split("/");
    const textElement = quotedElement.querySelector('[dir="auto"][lang]');
    return {
      author: author,
      url: new URL(`/${author}/status/${statusId}`, location.origin).href,
      text: textElement === null ? "" : textElement.textContent,
    };
  }
  const nameLine = quotedElement.querySelector('[data-testid="User-Name"]');
  const handleSpan = [...nameLine.querySelectorAll("span")].find((span) => span.textContent.startsWith("@"));
  const author = handleSpan === undefined ? "" : handleSpan.textContent.slice(1);
  const textElement = quotedElement.querySelector('[data-testid="tweetText"]');
  let url = "";
  const statusLink = quotedElement.querySelector(`a[href^="/${author}/status/"]`);
  if (statusLink !== null) {
    const [, linkAuthor, , statusId] = statusLink.getAttribute("href").split("/");
    url = new URL(`/${linkAuthor}/status/${statusId}`, location.origin).href;
  }
  return {
    author: author,
    url: url,
    text: textElement === null ? "" : textElement.textContent,
  };
}

// A link card (or a poll, which X draws as a card). In the data-testid markup it is a
// [data-testid="card.wrapper"]; in the redesign, the links off X that hold a picture, together with
// the "From <domain>" link under them.
function cardElementOf(tweetElement, quotedElement) {
  if (usesTestIds(tweetElement)) {
    return ownElements(tweetElement, quotedElement, '[data-testid="card.wrapper"]')[0] ?? null;
  }
  const pictureLink = ownElements(tweetElement, quotedElement, 'a[href^="https://t.co/"]')
    .find((link) => link.querySelector("img") !== null);
  return pictureLink === undefined ? null : pictureLink.parentElement;
}

// The card as the reader sees it: where it links, the linked site's domain, and every line it shows
// (the title, and the description or the poll's choices when it shows them). The domain is the first
// word of the card link's label in the data-testid markup, and follows "From " in the redesign.
function linkPreview(cardElement) {
  const link = cardElement.querySelector("a[href]");
  let url = "";
  let domain = "";
  if (link !== null) {
    url = link.href;
    domain = (link.getAttribute("aria-label") ?? "").split(" ")[0];
  }
  const lines = [];
  for (const textLeaf of cardElement.querySelectorAll("span, div")) {
    const line = textLeaf.textContent.trim();
    if (textLeaf.children.length > 0 || line === "") {
      continue;
    }
    if (line.startsWith("From ") && domain === "") {
      domain = line.slice("From ".length);
      continue;
    }
    if (line !== domain && line !== "From " + domain && !lines.includes(line)) {
      lines.push(line);
    }
  }
  return { url: url, domain: domain, text: lines.join("\n") };
}

// On a post's page X ends the replies with a section of unrelated posts under a "Discover more" heading,
// the only heading inside the timeline's cells. A tweet after that heading is a post, not a reply.
// X removes cells far from the viewport, so once the heading has been seen on a page, tweets rendered
// while it is gone are below it. The heading has only been seen in the data-testid markup.
let pagePathWhereRepliesEnd = null;

function comesAfterReplies(tweetElement) {
  const discoverMoreHeading = document.querySelector('[data-testid="cellInnerDiv"] h2[role="heading"]');
  if (discoverMoreHeading !== null) {
    pagePathWhereRepliesEnd = location.pathname;
    const position = discoverMoreHeading.compareDocumentPosition(tweetElement);
    return (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }
  return pagePathWhereRepliesEnd === location.pathname;
}

function statusIdOf(tweetElement) {
  const statusPath = ownStatusPath(tweetElement, quotedTweetElement(tweetElement));
  return statusPath === null ? null : statusPath.split("/")[3];
}

// The thread the open post continues, as X shows it above the post: the tweets from the top of the
// page down to the open post, or [] while the open post is not on the page.
function threadAboveOpenPost(openPostId) {
  const thread = [];
  for (const articleElement of document.querySelectorAll("article")) {
    if (!isTweet(articleElement)) {
      continue;
    }
    thread.push(articleElement);
    if (statusIdOf(articleElement) === openPostId) {
      return thread;
    }
  }
  return [];
}

// What a tweet on a post's page answers. X status ids grow with time, so a reply always has a larger
// id than the post it answers. Tweets with larger ids, above "Discover more", are replies to the open
// post. The open post and the older tweets above it are the thread it continues, each answering the
// tweet just above it; the first of them is the thread's post. Answers { kind, parentId }.
function placeInConversation(tweetElement, statusId, openPostId) {
  if (BigInt(statusId) > BigInt(openPostId)) {
    if (comesAfterReplies(tweetElement)) {
      return { kind: "post", parentId: "" };
    }
    return { kind: "reply", parentId: openPostId };
  }
  const thread = threadAboveOpenPost(openPostId);
  const position = thread.indexOf(tweetElement);
  if (position < 1) {
    return { kind: "post", parentId: "" };
  }
  const aboveId = statusIdOf(thread[position - 1]);
  if (aboveId === null || BigInt(aboveId) >= BigInt(statusId)) {
    return { kind: "post", parentId: "" };
  }
  return { kind: "reply", parentId: aboveId };
}

// The tweet's "More" menu button: [data-testid="caret"] in the data-testid markup, and in the
// redesign the first button opening a menu that is outside the row of actions and the quoted tweet.
function moreButtonOf(tweetElement) {
  if (usesTestIds(tweetElement)) {
    return tweetElement.querySelector('[data-testid="caret"]');
  }
  const quotedElement = quotedTweetElement(tweetElement);
  return ownElements(tweetElement, quotedElement, 'button[aria-haspopup="menu"]')
    .find((button) => button.closest('[role="group"]') === null) ?? null;
}

// The thumbs go at the top right of a tweet, just before X's "More" menu (after Grok's button when
// there is one), where X keeps actions about the tweet itself. Placed there in the flow, they take
// their room from the name line, which X cuts short a little sooner. They take the colour of
// X's icons, which follows its theme. Answers the tweet as the element whose hover shows them; a
// tweet still loading has no menu yet.
function placeJudgeControl(tweetElement, control) {
  const moreButton = moreButtonOf(tweetElement);
  if (moreButton === null) {
    return null;
  }
  // X wraps the menu button in several elements of one child each; the thumbs go just before them.
  let moreButtonCell = moreButton;
  while (moreButtonCell.parentElement.childElementCount === 1) {
    moreButtonCell = moreButtonCell.parentElement;
  }
  control.style.color = getComputedStyle(moreButton.querySelector("svg") ?? moreButton).color;
  control.dataset.xMenuRow = "";
  moreButtonCell.before(control);
  return tweetElement;
}

const siteAdapter = {
  platform: "x",

  // The tweets under rootNode, plus the tweet containing it.
  findPostElements(rootNode) {
    const found = [...rootNode.querySelectorAll("article")].filter(isTweet);
    let enclosing = rootNode.closest("article");
    while (enclosing !== null && !isTweet(enclosing)) {
      enclosing = enclosing.parentElement.closest("article");
    }
    if (enclosing !== null) {
      found.push(enclosing);
    }
    return found;
  },

  // The record sent to the server, or null when the tweet has no address of its own (see
  // ownStatusPath). On a post's own page a tweet may be a reply (see placeInConversation).
  extractPost(tweetElement) {
    const quotedElement = quotedTweetElement(tweetElement);
    const statusPath = ownStatusPath(tweetElement, quotedElement);
    if (statusPath === null) {
      return null;
    }
    const [, author, , statusId] = statusPath.split("/");
    const textElement = textElementOf(tweetElement, quotedElement);
    const cardElement = cardElementOf(tweetElement, quotedElement);
    const record = {
      platform: "x",
      kind: "post",
      post_id: statusId,
      url: new URL(statusPath, location.origin).href,
      author: author,
      community: "",
      text: textElement === null ? "" : textElement.textContent,
      image_urls: imageUrls(tweetElement),
      video_url: "",
      quoted_post: quotedElement === null ? null : quotedPost(quotedElement),
      link_preview: cardElement === null ? null : linkPreview(cardElement),
    };
    // A tweet showing a video or GIF, its own or its quoted tweet's, sends its own address; the server
    // finds the video's files from it.
    if (tweetElement.querySelector('[data-testid="videoPlayer"], video, a[href*="/status/"][href*="/video/"]') !== null) {
      record.video_url = record.url;
    }

    const openPostMatch = location.pathname.match(/^\/[^/]+\/status\/(\d+)/);
    if (openPostMatch !== null) {
      const place = placeInConversation(tweetElement, statusId, openPostMatch[1]);
      if (place.kind === "reply") {
        record.kind = "reply";
        record.parent_post_id = place.parentId;
      }
    }
    return record;
  },

  // treatment is described in content/post-decoration.js. The whole tweet is treated.
  applyAction(tweetElement, treatment) {
    decoratePost(tweetElement, treatment, (control) => placeJudgeControl(tweetElement, control));
  },
};
