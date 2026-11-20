// Site adapter for www.reddit.com. Every Reddit selector the extension uses is in this file.
// Feed posts and the post at the top of a thread are <shreddit-post> elements; comments in a thread
// are <shreddit-comment> elements. Both carry the item's details as attributes.
// Comments nest: a comment's replies are inside the comment's own element.

const POST_OR_COMMENT_SELECTOR = "shreddit-post, shreddit-comment";

// Media inside a post, excluding avatars, community icons and emoji. A text post can carry images in
// its body.
const POST_MEDIA_IMAGE_SELECTOR = [
  '[slot="post-media-container"] img',
  '[slot="text-body"] img',
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
  if (postElement.getAttribute("post-type") === "gallery") {
    return galleryImageUrls(postElement);
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

// One image per page of a gallery, at its original size. Each page holds the picture three times: a
// blurred background, a resized copy, and the upload itself on i.redd.it.
function galleryImageUrls(postElement) {
  const imageUrls = [];
  for (const page of postElement.querySelectorAll('[slot^="page-"]')) {
    const images = [...page.querySelectorAll("img")];
    const original = images.find((image) => image.src.startsWith("https://i.redd.it/")) ?? images.at(-1);
    if (original !== undefined && bestImageUrl(original) !== "") {
      imageUrls.push(bestImageUrl(original));
    }
  }
  return imageUrls;
}

// Where the post's player plays from: a video post's HLS playlist, or the MP4 copy Reddit plays for
// an animated GIF. "" for any other post.
function postVideoUrl(postElement) {
  const postType = postElement.getAttribute("post-type");
  if (postType !== "video" && postType !== "gif") {
    return "";
  }
  return postElement.querySelector("shreddit-player")?.getAttribute("src") ?? "";
}

// The page a link post links to. The post's title is its headline; the feed shows the domain and,
// shortened, the address.
function linkPreview(postElement) {
  if (postElement.getAttribute("post-type") !== "link") {
    return null;
  }
  return {
    url: postElement.getAttribute("content-href") ?? "",
    domain: postElement.getAttribute("domain") ?? "",
    text: "",
  };
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
    video_url: postVideoUrl(postElement),
    quoted_post: null,
    link_preview: linkPreview(postElement),
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
    // What the comment answers: the comment it replies to, or for a top-level comment the post.
    parent_post_id: commentElement.getAttribute("parentid") ?? commentElement.getAttribute("postid"),
    url: new URL(permalink, location.origin).href,
    author: commentElement.getAttribute("author") ?? "",
    community: permalink.split("/").slice(1, 3).join("/"), // "/r/name/comments/..." gives "r/name"
    text: body.textContent.trim(),
    image_urls: [...imageUrls],
  };
}

// Reddit draws its rows of actions inside its elements' shadow roots and lets pages add to them
// through named slots: a post's row ends in "action-row-whitespace", and a comment's row has
// "comment-insight" between Share and the "..." menu. A comment's thumbs show on hovering the comment
// itself, not its replies (post-decoration.js counts the innermost post under the pointer).
function placeJudgeControl(element, control) {
  if (element.tagName === "SHREDDIT-COMMENT") {
    // Found by the comment's id, because a comment element also holds its replies' rows.
    const actionRow = element.querySelector(`shreddit-comment-action-row[comment-id="${element.getAttribute("thingid")}"]`);
    if (actionRow === null) {
      return null;
    }
    control.slot = "comment-insight";
    actionRow.append(control);
    return element;
  }
  control.slot = "action-row-whitespace";
  element.append(control);
  return element;
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
    const placeControl = (control) => placeJudgeControl(element, control);
    if (element.tagName === "SHREDDIT-COMMENT") {
      decoratePost(ownCommentBody(element), treatment, placeControl);
    } else {
      decoratePost(element, treatment, placeControl);
    }
  },
};
