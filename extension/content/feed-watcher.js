// Watches a feed for posts, asks the background worker how to treat each one, and applies the answers.
// Loaded after extension-api.js, post-decoration.js and one site adapter (sites/*.js), which defines
// `siteAdapter`. Nothing in this file knows a site's markup.
//
// A post is sent once it comes within about a screen of the viewport. A post answered in this page is
// never sent again, and its answer is re-applied whenever the site renders that post again.

const BATCH_QUIET_MS = 150;
const BATCH_MAX_POSTS = 25;
const PENDING_RETRY_DELAYS_MS = [2000, 4000, 8000];
const ALLOW_ANSWER = { status: "done", action: "allow", reasons: [] };

let config = null;  // server config while watching; null while stopped

const answerByPostId = new Map();          // answers received in this page
const requestedPostIds = new Set();        // posts sent to the server, answered or not
const revealedPostIds = new Set();         // blurred posts the reader clicked open
const waitingElementsByPostId = new Map(); // elements showing a post whose answer has not arrived
const postIdByElement = new WeakMap();     // the post each element showed when last seen

let postsForNextBatch = [];
let batchTimer = null;

const nearViewportObserver = new IntersectionObserver(onPostsNearViewport, { rootMargin: "1000px 0px" });
const pageChangeObserver = new MutationObserver(onPageChanges);

function pluginThatFlagged(answer) {
  let strongestReason = answer.reasons[0];
  for (const reason of answer.reasons) {
    if (reason.score > strongestReason.score) {
      strongestReason = reason;
    }
  }
  return strongestReason.plugin;
}

function showAnswer(postElement, postId, answer) {
  if (revealedPostIds.has(postId) || answer.action === "allow") {
    siteAdapter.applyAction(postElement, { action: "allow" });
    return;
  }
  siteAdapter.applyAction(postElement, {
    action: answer.action,
    pluginName: pluginThatFlagged(answer),
    allowReveal: config.allow_reveal,
    onReveal: () => revealedPostIds.add(postId),
  });
}

function showWaiting(postElement, postId) {
  let waitingElements = waitingElementsByPostId.get(postId);
  if (waitingElements === undefined) {
    waitingElements = new Set();
    waitingElementsByPostId.set(postId, waitingElements);
  }
  waitingElements.add(postElement);

  if (config.pending_action === "blur") {
    siteAdapter.applyAction(postElement, { action: "pending" });
  } else {
    siteAdapter.applyAction(postElement, { action: "allow" });
  }
}

// Called for every post element the site adds or changes. Sites reuse elements for other posts,
// so the element's current post id decides what it shows.
function handlePostElement(postElement) {
  const post = siteAdapter.extractPost(postElement);
  if (post === null) {
    return;
  }
  postIdByElement.set(postElement, post.post_id);

  const answer = answerByPostId.get(post.post_id);
  if (answer !== undefined) {
    showAnswer(postElement, post.post_id, answer);
  } else if (requestedPostIds.has(post.post_id)) {
    showWaiting(postElement, post.post_id);
  } else {
    siteAdapter.applyAction(postElement, { action: "allow" });
    nearViewportObserver.observe(postElement);
  }
}

function onPageChanges(mutations) {
  const changedPosts = new Set();
  for (const mutation of mutations) {
    for (const addedNode of mutation.addedNodes) {
      if (addedNode.nodeType !== Node.ELEMENT_NODE || addedNode.classList.contains(NOTICE_CLASS)) {
        continue;
      }
      for (const postElement of siteAdapter.findPostElements(addedNode)) {
        changedPosts.add(postElement);
      }
    }
  }
  for (const postElement of changedPosts) {
    handlePostElement(postElement);
  }
}

function onPostsNearViewport(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) {
      continue;
    }
    nearViewportObserver.unobserve(entry.target);
    const post = siteAdapter.extractPost(entry.target);
    if (post === null || requestedPostIds.has(post.post_id)) {
      continue;
    }
    requestedPostIds.add(post.post_id);
    postIdByElement.set(entry.target, post.post_id);
    showWaiting(entry.target, post.post_id);
    addToNextBatch(post);
  }
}

function addToNextBatch(post) {
  postsForNextBatch.push(post);
  clearTimeout(batchTimer);
  if (postsForNextBatch.length >= BATCH_MAX_POSTS) {
    sendNextBatch();
  } else {
    batchTimer = setTimeout(sendNextBatch, BATCH_QUIET_MS);
  }
}

function sendNextBatch() {
  const batch = postsForNextBatch;
  postsForNextBatch = [];
  requestAnswers(batch, 0);
}

// Sends posts to the server through the background worker. Posts the server is still working on are
// asked about again after 2, 4 and 8 seconds, then treated as allowed.
async function requestAnswers(posts, retryCount) {
  const reply = await extensionApi.runtime.sendMessage({ type: "classify", posts: posts });
  if (config === null) {
    return;
  }
  if (reply.state !== "connected") {
    for (const post of posts) {
      receiveAnswer(post.post_id, ALLOW_ANSWER);
    }
    if (reply.state === "not-connected" || reply.state === "no-subscription") {
      stopWatching();
    }
    return;
  }

  const postById = new Map(posts.map((post) => [post.post_id, post]));
  const stillPendingPosts = [];
  for (const result of reply.results) {
    if (result.status === "done") {
      receiveAnswer(result.post_id, result);
    } else {
      stillPendingPosts.push(postById.get(result.post_id));
    }
  }
  if (stillPendingPosts.length === 0) {
    return;
  }

  if (retryCount === PENDING_RETRY_DELAYS_MS.length) {
    for (const post of stillPendingPosts) {
      receiveAnswer(post.post_id, ALLOW_ANSWER);
    }
  } else {
    setTimeout(() => requestAnswers(stillPendingPosts, retryCount + 1), PENDING_RETRY_DELAYS_MS[retryCount]);
  }
}

function receiveAnswer(postId, answer) {
  answerByPostId.set(postId, answer);
  for (const postElement of waitingElementsByPostId.get(postId) ?? []) {
    if (postIdByElement.get(postElement) === postId) {
      showAnswer(postElement, postId, answer);
    }
  }
  waitingElementsByPostId.delete(postId);
}

async function startWatching() {
  const status = await extensionApi.runtime.sendMessage({ type: "get-status" });
  if (status.state !== "connected"
      || !status.config.enabled
      || !status.config.platforms.includes(siteAdapter.platform)) {
    return;
  }
  config = status.config;
  pageChangeObserver.observe(document.body, { childList: true, subtree: true });
  for (const postElement of siteAdapter.findPostElements(document.body)) {
    handlePostElement(postElement);
  }
}

function stopWatching() {
  config = null;
  pageChangeObserver.disconnect();
  nearViewportObserver.disconnect();
  clearTimeout(batchTimer);
  postsForNextBatch = [];
  answerByPostId.clear();
  requestedPostIds.clear();
  waitingElementsByPostId.clear();
  for (const postElement of siteAdapter.findPostElements(document.body)) {
    siteAdapter.applyAction(postElement, { action: "allow" });
  }
}

extensionApi.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || changes.extensionEnabled === undefined) {
    return;
  }
  if (changes.extensionEnabled.newValue) {
    startWatching();
  } else {
    stopWatching();
  }
});

extensionApi.storage.local.get("extensionEnabled").then((stored) => {
  if (stored.extensionEnabled) {
    startWatching();
  }
});
