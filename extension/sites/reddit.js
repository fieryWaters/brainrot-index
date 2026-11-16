// Site adapter for www.reddit.com. Every Reddit selector the extension uses is in this file.
// Feed posts and the post at the top of a thread are <shreddit-post> elements; comments in a thread
// are <shreddit-comment> elements. Both carry the item's details as attributes.
// Comments nest: a comment's replies are inside the comment's own element.

const POST_OR_COMMENT_SELECTOR = "shreddit-post, shreddit-comment";

// Media inside a post, excluding avatars, community icons and emoji.
const POST_MEDIA_IMAGE_SELECTOR = [
  '[slot="post-media-container"] img',
  '[slot^="page-"] img',
  '[slot="poster"] img',
  '[slot="thumbnail"] img',
].join(", ");

// The widest image a srcset offers, or src when there is no srcset. An image Reddit has not started
// loading yet has neither, and gives "".
function bestImageUrl(image) {
  const srcset = image.getAttribute("srcset");
  if (srcset === null || srcset === "") {
    return image.src;
  }
  let bestUrl = image.src;
  let bestWidth = 0;
  for (const candidate of srcset.split(",")) {
    const [url, widthDescriptor] = candidate.trim().split(/\s+/);
    const width = parseInt(widthDescriptor, 10);
    if (width > bestWidth) {
      bestWidth = width;
      bestUrl = url;
    }
  }
  return bestUrl;
}

function postImageUrls(postElement) {
  // For image posts content-href is the original upload; the <img> elements are resized copies.
  if (postElement.getAttribute("post-type") === "image") {
    return [postElement.getAttribute("content-href")];
  }
  const imageUrls = new Set();
  for (const image of postElement.querySelectorAll(POST_MEDIA_IMAGE_SELECTOR)) {
    const url = bestImageUrl(image);
    if (url !== "") {
      imageUrls.add(url);
    }
  }
  return [...imageUrls];
}

// The comment's own text element, found by the comment's id because a comment element also
// contains the text elements of its replies.
function ownCommentBody(commentElement) {
  const commentId = commentElement.getAttribute("thingid");
  return commentElement.querySelector(`[id="${commentId}-comment-rtjson-content"]`);
}

function extractFeedPost(postElement) {
  const postId = postElement.getAttribute("id");
  if (postId === null) {
    return null;
  }
  const title = postElement.getAttribute("post-title") ?? "";
  const bodyElement = postElement.querySelector('[slot="text-body"]');
  let text = title;
  if (bodyElement !== null) {
    text = title + "\n\n" + bodyElement.textContent.trim();
  }
  return {
    platform: "reddit",
    kind: "post",
    post_id: postId,
    url: new URL(postElement.getAttribute("permalink"), location.origin).href,
    author: postElement.getAttribute("author") ?? "",
    community: postElement.getAttribute("subreddit-prefixed-name") ?? "",
    text: text,
    image_urls: postImageUrls(postElement),
  };
}

function extractComment(commentElement) {
  const body = ownCommentBody(commentElement);
  if (body === null) {
    return null;
  }
  const permalink = commentElement.getAttribute("permalink");
  const imageUrls = new Set();
  for (const image of body.querySelectorAll("img")) {
    const url = bestImageUrl(image);
    if (url !== "") {
      imageUrls.add(url);
    }
  }
  return {
    platform: "reddit",
    kind: "reply",
    post_id: commentElement.getAttribute("thingid"),
    parent_post_id: commentElement.getAttribute("postid"),
    url: new URL(permalink, location.origin).href,
    author: commentElement.getAttribute("author") ?? "",
    community: permalink.split("/").slice(1, 3).join("/"), // "/r/name/comments/..." gives "r/name"
    text: body.textContent.trim(),
    image_urls: [...imageUrls],
  };
}

const siteAdapter = {
  platform: "reddit",

  // The posts and comments under rootNode, plus the innermost one containing it.
  findPostElements(rootNode) {
    const found = [...rootNode.querySelectorAll(POST_OR_COMMENT_SELECTOR)];
    const enclosing = rootNode.closest(POST_OR_COMMENT_SELECTOR);
    if (enclosing !== null) {
      found.push(enclosing);
    }
    return found;
  },

  // The record sent to the server, or null when the element is not filled in yet.
  extractPost(element) {
    if (element.tagName === "SHREDDIT-COMMENT") {
      return extractComment(element);
    }
    return extractFeedPost(element);
  },

  // treatment is described in content/post-decoration.js. A post is treated whole. For a comment only
  // its own text is treated, so its author line and its replies stay visible and the thread keeps its shape.
  applyAction(element, treatment) {
    if (element.tagName === "SHREDDIT-COMMENT") {
      decoratePost(ownCommentBody(element), treatment);
    } else {
      decoratePost(element, treatment);
    }
  },
};
