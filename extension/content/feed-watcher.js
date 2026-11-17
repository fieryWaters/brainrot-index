// Watches a feed for posts, asks the background worker how to treat each one, and applies the answers.
// Loaded after extension-api.js, post-decoration.js and one site adapter (sites/*.js), which defines
// `siteAdapter`. Nothing in this file knows a site's markup.
//
// A post is sent once it comes within about a screen of the viewport. A post answered in this page is
// never sent again, and its answer is re-applied whenever the site renders that post again.

const BATCH_QUIET_MS = 150;
const BATCH_MAX_POSTS = 25;
// Posts the server is still working on are asked about again: quickly at first, then every 8 seconds,
// for up to 2 minutes after they were first sent, and only while they are still in the page.
const FAST_REASK_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const SLOW_REASK_DELAY_MS = 8000;
const GIVE_UP_AFTER_MS = 120000;
const ALLOW_ANSWER = { status: "done", action: "allow", reasons: [] };

let config = null;  // server config while watching; null while stopped

const answerByPostId = new Map();          // answers received in this page
const requestedPostIds = new Set();        // posts sent to the server, answered or not
const revealedPostIds = new Set();         // blurred or hidden posts the reader chose to see
const judgmentByPostId = new Map();        // the reader's thumbs in this page: post_id -> { verdict, id }
const waitingElementsByPostId = new Map(); // elements showing a post whose answer has not arrived
const postIdByElement = new WeakMap();     // the post each element showed when last seen
const transcriptSentPostIds = new Set();   // videos whose transcript was fetched and sent, or is on its way

let postsForNextBatch = [];
let batchTimer = null;

// Posts the server answered "pending": post_id -> { post, firstSentAt, reaskCount, nextAskAt }.
// One timer serves them all, and at most one re-ask request is in flight.
const pendingByPostId = new Map();
let reaskTimer = null;
let reaskInFlight = false;

const nearViewportObserver = new IntersectionObserver(onPostsNearViewport, { rootMargin: "1000px 0px" });
const pageChangeObserver = new MutationObserver(onPageChanges);

function sendPostFeedback(postId, shownAction, expectedAction, text) {
  return extensionApi.runtime.sendMessage({
    type: "send-feedback",
    feedback: {
      page_url: location.href,
      platform: siteAdapter.platform,
      post_id: postId,
      shown_action: shownAction,
      expected_action: expectedAction,
      text: text,
    },
  });
}

// The thumbs up and down for a post the server answered for. A post past the daily limit, or one
// shown because the server never answered, was never classified, so there is nothing to judge.
function judgmentFor(postId, answer, shownAction) {
  if (answer.notice !== undefined || answer === ALLOW_ANSWER) {
    return undefined;
  }
  return {
    verdict: judgmentByPostId.get(postId)?.verdict ?? null,
    plugins: config.plugins ?? [],
    onJudge: async (verdict) => {
      const reply = await extensionApi.runtime.sendMessage({
        type: "send-judgment",
        judgment: { platform: siteAdapter.platform, post_id: postId, verdict: verdict, shown_action: shownAction },
      });
      if (reply.sent) {
        judgmentByPostId.set(postId, { verdict: verdict, id: reply.body.id });
      }
      return reply;
    },
    onAddDetails: (details) => extensionApi.runtime.sendMessage({
      type: "add-judgment-details",
      judgmentId: judgmentByPostId.get(postId).id,
      details: details,
    }),
  };
}

// shownAction is normally answer.action; receiveAnswer passes "blur" for a hidden post on or above
// the screen. A revealed post stays revealed in this page, also when the site draws it again.
function showAnswer(postElement, postId, answer, shownAction = answer.action) {
  if (shownAction === "allow") {
    siteAdapter.applyAction(postElement, { action: "allow", postId: postId, judgment: judgmentFor(postId, answer, "allow") });
    return;
  }
  siteAdapter.applyAction(postElement, {
    action: shownAction,
    postId: postId,
    reason: answer.reasons[0], // the server orders reasons by score, highest first
    allowReveal: config.allow_reveal,
    revealed: config.allow_reveal && revealedPostIds.has(postId),
    onToggleReveal: () => {
      if (revealedPostIds.has(postId)) {
        revealedPostIds.delete(postId);
      } else {
        revealedPostIds.add(postId);
      }
      showAnswer(postElement, postId, answer, shownAction);
    },
    judgment: judgmentFor(postId, answer, shownAction),
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

// A changed link address means the site may have filled an element with another post.
function onPageChanges(mutations) {
  const changedPosts = new Set();
  for (const mutation of mutations) {
    if (mutation.type === "attributes") {
      for (const postElement of siteAdapter.findPostElements(mutation.target)) {
        changedPosts.add(postElement);
      }
      continue;
    }
    for (const addedNode of mutation.addedNodes) {
      if (addedNode.nodeType !== Node.ELEMENT_NODE || addedNode.classList.contains(NOTICE_CLASS)
          || addedNode.classList.contains(JUDGE_CLASS)) {
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
    if (post === null) {
      continue;
    }
    // Another element showing the same post was sent first; this one shows its answer or waits for it.
    if (requestedPostIds.has(post.post_id)) {
      handlePostElement(entry.target);
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
  requestAnswers(batch);
}

// Sends posts to the server through the background worker and applies the answers.
async function requestAnswers(posts) {
  const sentAt = Date.now();
  const reply = await extensionApi.runtime.sendMessage({ type: "classify", posts: posts });
  if (config === null) {
    return;
  }
  if (reply.state !== "connected") {
    for (const post of posts) {
      pendingByPostId.delete(post.post_id);
      receiveAnswer(post.post_id, ALLOW_ANSWER);
    }
    if (reply.state === "not-connected" || reply.state === "no-subscription" || reply.state === "email-not-verified") {
      stopWatching();
    }
    return;
  }
  if (reply.showDailyLimitNotice) {
    showPageNotice("BrainRot Index: daily limit reached. New posts are shown unchecked until tomorrow (UTC).");
  }

  const postById = new Map(posts.map((post) => [post.post_id, post]));
  for (const result of reply.results) {
    if (result.status === "done") {
      pendingByPostId.delete(result.post_id);
      receiveAnswer(result.post_id, result);
      continue;
    }
    let pending = pendingByPostId.get(result.post_id);
    if (pending === undefined) {
      pending = { post: postById.get(result.post_id), firstSentAt: sentAt, reaskCount: 0 };
      pendingByPostId.set(result.post_id, pending);
    }
    if (result.transcript_wanted && siteAdapter.fetchTranscript !== undefined
        && !transcriptSentPostIds.has(result.post_id)) {
      transcriptSentPostIds.add(result.post_id);
      sendTranscript(pending.post);
    }
    pending.nextAskAt = Date.now() + (FAST_REASK_DELAYS_MS[pending.reaskCount] ?? SLOW_REASK_DELAY_MS);
    pending.reaskCount = pending.reaskCount + 1;
  }
  scheduleReask();
}

// The server never classified this video and asked for its transcript: the site adapter fetches it,
// and the post is sent again with it straight away.
async function sendTranscript(post) {
  const transcriptFields = await siteAdapter.fetchTranscript(post.post_id);
  if (config === null) {
    return;
  }
  await requestAnswers([{ ...post, ...transcriptFields }]);
}

function scheduleReask() {
  clearTimeout(reaskTimer);
  if (pendingByPostId.size === 0 || reaskInFlight) {
    return;
  }
  let earliestAskAt = Infinity;
  for (const pending of pendingByPostId.values()) {
    earliestAskAt = Math.min(earliestAskAt, pending.nextAskAt);
  }
  reaskTimer = setTimeout(reaskPendingPosts, Math.max(0, earliestAskAt - Date.now()));
}

function isPostInPage(postId) {
  for (const postElement of waitingElementsByPostId.get(postId) ?? []) {
    if (postElement.isConnected && postIdByElement.get(postElement) === postId) {
      return true;
    }
  }
  return false;
}

// Asks again, in one request, about every pending post that is due. A post that has left the page is
// forgotten, so it is sent afresh if the site shows it again; one pending for 2 minutes is allowed.
async function reaskPendingPosts() {
  const now = Date.now();
  const duePosts = [];
  for (const [postId, pending] of pendingByPostId) {
    if (!isPostInPage(postId)) {
      pendingByPostId.delete(postId);
      requestedPostIds.delete(postId);
      waitingElementsByPostId.delete(postId);
    } else if (now - pending.firstSentAt >= GIVE_UP_AFTER_MS) {
      pendingByPostId.delete(postId);
      receiveAnswer(postId, ALLOW_ANSWER);
    } else if (pending.nextAskAt <= now && duePosts.length < BATCH_MAX_POSTS) {
      duePosts.push(pending.post);
    }
  }
  if (duePosts.length === 0) {
    scheduleReask();
    return;
  }
  reaskInFlight = true;
  try {
    await requestAnswers(duePosts);
  } finally {
    reaskInFlight = false;
  }
  scheduleReask();
}

// Collapsing a post that is on screen or above it would move what the reader is looking at, so such a
// post is blurred instead (blurring does not change its height). Answers can take many seconds, so this
// is common. The post is collapsed the next time the site renders it.
function receiveAnswer(postId, answer) {
  answerByPostId.set(postId, answer);
  for (const postElement of waitingElementsByPostId.get(postId) ?? []) {
    if (postIdByElement.get(postElement) !== postId) {
      continue;
    }
    if (answer.action === "hide" && postElement.getBoundingClientRect().top < window.innerHeight) {
      showAnswer(postElement, postId, answer, "blur");
    } else {
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
  pageChangeObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
  for (const postElement of siteAdapter.findPostElements(document.body)) {
    handlePostElement(postElement);
  }
}

function stopWatching() {
  config = null;
  pageChangeObserver.disconnect();
  nearViewportObserver.disconnect();
  clearTimeout(batchTimer);
  clearTimeout(reaskTimer);
  postsForNextBatch = [];
  pendingByPostId.clear();
  answerByPostId.clear();
  requestedPostIds.clear();
  transcriptSentPostIds.clear();
  waitingElementsByPostId.clear();
  for (const postElement of siteAdapter.findPostElements(document.body)) {
    siteAdapter.applyAction(postElement, { action: "allow" });
  }
}

// The post the reader last right-clicked, for the "this should have been filtered" menu item.
let rightClickedPostElement = null;

document.addEventListener("contextmenu", (event) => {
  const postsAroundTarget = siteAdapter.findPostElements(event.target);
  rightClickedPostElement = [...postsAroundTarget].find((postElement) => postElement.contains(event.target)) ?? null;
}, true);

// The "this should have been filtered" menu item opens the report form over the post the reader
// right-clicked. Answers false when the right-click was not inside a post, or inside an element the
// extension never sends (such as a YouTube playlist).
extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "open-report-form") {
    return;
  }
  if (rightClickedPostElement === null) {
    sendResponse(false);
    return;
  }
  const post = siteAdapter.extractPost(rightClickedPostElement);
  if (post === null) {
    sendResponse(false);
    return;
  }
  const answer = answerByPostId.get(post.post_id);
  let shownAction = "allow";
  if (answer !== undefined) {
    shownAction = answer.action;
  }
  showReportFormAbovePost(rightClickedPostElement, shownAction, (expectedAction, text) =>
    sendPostFeedback(post.post_id, shownAction, expectedAction, text));
  sendResponse(true);
});

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
