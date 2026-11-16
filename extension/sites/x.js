// Site adapter for x.com (signed in). Every X selector the extension uses is in this file.
// Each post on the home timeline, and each reply on a post's page (/<user>/status/<id>), is an
// <article data-testid="tweet">. Its own link to itself is the one wrapping its timestamp.

const TWEET_SELECTOR = 'article[data-testid="tweet"]';

// "/<user>/status/<id>" for the tweet itself. Quoted tweets come later in the article, so the first
// timestamp link is the tweet's own.
function ownStatusPath(tweetElement) {
  const timestamp = tweetElement.querySelector('a[href*="/status/"] time');
  if (timestamp === null) {
    return null;
  }
  return timestamp.closest("a").getAttribute("href");
}

// Image URLs at the best size X offers. Photos ("/media/" URLs) come in sizes chosen by the "name"
// parameter, and "orig" is the upload. Video and GIF thumbnails appear both as an <img> in the photo
// area and as the video's poster, so duplicates are dropped.
function imageUrls(tweetElement) {
  const urls = new Set();
  for (const image of tweetElement.querySelectorAll('[data-testid="tweetPhoto"] img')) {
    const url = new URL(image.src);
    if (url.pathname.startsWith("/media/")) {
      url.searchParams.set("name", "orig");
    }
    urls.add(url.href);
  }
  for (const video of tweetElement.querySelectorAll("video[poster]")) {
    urls.add(video.poster);
  }
  return [...urls];
}

// On a post's page X ends the replies with a section of unrelated posts under a "Discover more" heading,
// the only heading inside the timeline's cells. A tweet after that heading is a post, not a reply.
// X removes cells far from the viewport, so once the heading has been seen on a page, tweets rendered
// while it is gone are below it.
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

const siteAdapter = {
  platform: "x",

  // The tweets under rootNode, plus the tweet containing it.
  findPostElements(rootNode) {
    const found = [...rootNode.querySelectorAll(TWEET_SELECTOR)];
    const enclosing = rootNode.closest(TWEET_SELECTOR);
    if (enclosing !== null) {
      found.push(enclosing);
    }
    return found;
  },

  // The record sent to the server, or null when the tweet has no timestamp link: either it is not
  // rendered yet, or it is a promoted tweet (ads show "Ad" instead of a time), which is never sent.
  // On a post's own page every other tweet is treated as a reply to that post.
  extractPost(tweetElement) {
    const statusPath = ownStatusPath(tweetElement);
    if (statusPath === null) {
      return null;
    }
    const [, author, , statusId] = statusPath.split("/");
    const textElement = tweetElement.querySelector('[data-testid="tweetText"]');
    const record = {
      platform: "x",
      kind: "post",
      post_id: statusId,
      url: new URL(statusPath, location.origin).href,
      author: author,
      community: "",
      text: textElement === null ? "" : textElement.textContent,
      image_urls: imageUrls(tweetElement),
    };

    const openPostMatch = location.pathname.match(/^\/[^/]+\/status\/(\d+)/);
    if (openPostMatch !== null && openPostMatch[1] !== statusId && !comesAfterReplies(tweetElement)) {
      record.kind = "reply";
      record.parent_post_id = openPostMatch[1];
    }
    return record;
  },

  // treatment is described in content/post-decoration.js. The whole tweet is treated.
  applyAction(tweetElement, treatment) {
    decoratePost(tweetElement, treatment);
  },
};
