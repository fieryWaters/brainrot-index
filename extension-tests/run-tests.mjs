// End-to-end tests of the extension in headed Brave against live Reddit and X.
//
// Usage:
//   node run-tests.mjs [reddit] [x]
//     Runs the named groups (both when none are named) against the mock server, which it starts.
//   BRAINROT_SERVER=https://brainrot.jacob-waters.com BRAINROT_TOKEN=<token> node run-tests.mjs
//     Runs against a real server. The connect test is skipped (the real site needs a login), and the
//     checks that depend on the mock's fixed rules (pending first, at least one blur and one hide)
//     are reported instead of asserted.
//
// The reddit group uses a fresh profile in .profiles/. The x group uses the signed-in test profile
// below and only reads: it never posts, likes, follows or changes anything.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { makeFreshProfileDir, launchBrave, EXTENSION_DIR } from "./browser.mjs";
import { startMockServer, MOCK_TOKEN } from "./mock-server.mjs";

const X_TEST_PROFILE_DIR = "/Users/jacob/git-repos/brainrot-test-profile";
const DEFAULT_SERVER_ADDRESS = "https://brainrot.jacob-waters.com";
const MOCK_PORT = 8787;

const usingMockServer = process.env.BRAINROT_SERVER === undefined;
const serverAddress = process.env.BRAINROT_SERVER ?? `http://127.0.0.1:${MOCK_PORT}`;
const token = process.env.BRAINROT_TOKEN ?? MOCK_TOKEN;

// Lets Playwright see the extension service worker's fetches, so tests can read every classify call.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const testResults = [];

function check(condition, description) {
  if (!condition) {
    throw new Error("check failed: " + description);
  }
  console.log("    ok: " + description);
}

async function runTest(name, testFunction) {
  console.log("\n== " + name);
  try {
    await testFunction();
    testResults.push({ name, passed: true });
  } catch (error) {
    console.log("    FAIL: " + error.message);
    testResults.push({ name, passed: false, error: error.message });
  }
}

async function waitUntil(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

// Every POST /api/classify/ the extension makes: the posts sent and the results received, in order.
function recordClassifyCalls(context) {
  const classifyCalls = [];
  context.on("requestfinished", async (request) => {
    if (!request.url().endsWith("/api/classify/")) {
      return;
    }
    const response = await request.response();
    classifyCalls.push({ posts: request.postDataJSON().posts, results: (await response.json()).results });
  });
  return classifyCalls;
}

// Every POST /api/feedback/ body the extension sends, with the response status.
function recordFeedbackCalls(context) {
  const feedbackCalls = [];
  context.on("requestfinished", async (request) => {
    if (!request.url().endsWith("/api/feedback/")) {
      return;
    }
    const response = await request.response();
    feedbackCalls.push({ body: request.postDataJSON(), status: response.status() });
  });
  return feedbackCalls;
}

// The commit string the extension should attach, from the build-info.json written by stamp-build-info.mjs.
function expectedExtensionCommit() {
  const buildInfoPath = path.join(EXTENSION_DIR, "build-info.json");
  if (!fs.existsSync(buildInfoPath)) {
    return "unstamped";
  }
  const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, "utf8"));
  return buildInfo.dirty ? buildInfo.commit + "-dirty" : buildInfo.commit;
}

function checkFeedbackCall(feedbackCall, expectedFields) {
  check(feedbackCall !== undefined, "a feedback request was sent");
  console.log("    feedback sent: " + JSON.stringify(feedbackCall.body));
  check(feedbackCall.status === 201, "server answered 201");
  check(feedbackCall.body.source === "extension", "source is extension");
  check(feedbackCall.body.extension_commit === expectedExtensionCommit(), "extension_commit is " + expectedExtensionCommit());
  for (const [field, value] of Object.entries(expectedFields)) {
    check(feedbackCall.body[field] === value, `${field} is ${value}`);
  }
}

// One click on a blurred or hidden post's "Wrong?" control reports it as wrongly filtered.
async function testReportWrongControl(page, feedbackCalls) {
  const reportWrongButton = page.locator(".brainrot-index-report-wrong").first();
  check(await reportWrongButton.count() === 1, "a filtered post shows a Wrong? control");
  const reportedPost = await reportWrongButton.evaluate((button) => {
    const postElement = button.parentElement.nextElementSibling;
    return { id: postElement.id, action: postElement.dataset.brainrotIndexAction };
  });
  const callsBefore = feedbackCalls.length;
  await reportWrongButton.scrollIntoViewIfNeeded();
  await reportWrongButton.click();
  await waitUntil(() => feedbackCalls.length > callsBefore, 5000);
  checkFeedbackCall(feedbackCalls[callsBefore], {
    platform: "reddit",
    post_id: reportedPost.id,
    shown_action: reportedPost.action,
    expected_action: "allow",
    page_url: page.url(),
  });
  check(await reportWrongButton.textContent() === "Recorded", "the label confirms it was recorded");
}

// The context menu item cannot be clicked from a test, so the test right-clicks a post (a contextmenu
// event) and then runs the worker function the menu item calls.
async function testMissedPostMenuItem(page, serviceWorker, feedbackCalls) {
  const unfilteredPost = page.locator("shreddit-post:not([data-brainrot-index-action])").first();
  const postId = await unfilteredPost.getAttribute("id");
  await unfilteredPost.dispatchEvent("contextmenu");
  const callsBefore = feedbackCalls.length;
  await serviceWorker.evaluate(async (pageUrl) => {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return reportMissedPost(activeTab.id, 0, pageUrl);
  }, page.url());
  await waitUntil(() => feedbackCalls.length > callsBefore, 5000);
  checkFeedbackCall(feedbackCalls[callsBefore], {
    platform: "reddit",
    post_id: postId,
    shown_action: "allow",
    expected_action: "hide",
  });
}

async function testPopupFeedbackBox(context, extensionId, feedbackCalls) {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.waitForTimeout(1000);
  check(await popupPage.textContent("#extension-commit") === expectedExtensionCommit(), "popup shows the extension commit");
  const callsBefore = feedbackCalls.length;
  await popupPage.fill("#feedback-text", "Automated test feedback from the popup");
  await popupPage.click("#feedback-form button");
  await waitUntil(() => feedbackCalls.length > callsBefore, 5000);
  checkFeedbackCall(feedbackCalls[callsBefore], { text: "Automated test feedback from the popup" });
  await waitUntil(async () => (await popupPage.textContent("#feedback-status")) !== "", 3000);
  check(await popupPage.textContent("#feedback-status") === "Sent, thank you", "popup confirms it was sent");
  await popupPage.close();
}

async function configureExtension(serviceWorker) {
  await serviceWorker.evaluate(
    (settings) => chrome.storage.local.set(settings),
    { serverAddress: serverAddress, token: token }
  );
}

async function readCachedAnswers(serviceWorker) {
  const sessionEntries = await serviceWorker.evaluate(() => chrome.storage.session.get(null));
  const answerById = new Map();
  for (const [key, answer] of Object.entries(sessionEntries)) {
    if (key.startsWith("answer:")) {
      answerById.set(answer.post_id, answer);
    }
  }
  return answerById;
}

async function scrollDown(page, times) {
  for (let step = 0; step < times; step++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(1500);
  }
}

// The extension's treatment of each post and reply visible to the test, read from the DOM.
// Selectors are repeated here on purpose: the test must not depend on the code it tests.
function readTreatmentsInPage(platform) {
  const treatments = [];
  if (platform === "reddit") {
    for (const post of document.querySelectorAll("shreddit-post")) {
      treatments.push({ id: post.id, kind: "post", action: post.dataset.brainrotIndexAction ?? "allow" });
    }
    for (const comment of document.querySelectorAll("shreddit-comment")) {
      const body = document.getElementById(comment.getAttribute("thingid") + "-comment-rtjson-content");
      if (body !== null) {
        treatments.push({ id: comment.getAttribute("thingid"), kind: "reply", action: body.dataset.brainrotIndexAction ?? "allow" });
      }
    }
  } else {
    for (const tweet of document.querySelectorAll('article[data-testid="tweet"]')) {
      const timeLink = tweet.querySelector("a[href*='/status/'] time")?.closest("a");
      if (timeLink !== undefined && timeLink !== null) {
        const statusId = timeLink.getAttribute("href").split("/status/")[1].split("/")[0];
        treatments.push({ id: statusId, action: tweet.dataset.brainrotIndexAction ?? "allow" });
      }
    }
  }
  return treatments;
}

// Checks that every answered post on the page shows the action the server gave it.
async function checkPageMatchesAnswers(page, serviceWorker, platform) {
  const answerById = await readCachedAnswers(serviceWorker);
  const treatments = await page.evaluate(readTreatmentsInPage, platform);
  let answeredCount = 0;
  const mismatches = [];
  const actionCounts = { allow: 0, blur: 0, hide: 0, pending: 0 };
  for (const treatment of treatments) {
    actionCounts[treatment.action] = actionCounts[treatment.action] + 1;
    const answer = answerById.get(treatment.id);
    if (answer === undefined) {
      continue;
    }
    answeredCount = answeredCount + 1;
    if (answer.action !== treatment.action) {
      mismatches.push(`${treatment.id}: answer ${answer.action}, page shows ${treatment.action}`);
    }
  }
  console.log(`    page: ${treatments.length} items, ${answeredCount} answered, actions ${JSON.stringify(actionCounts)}`);
  check(answeredCount > 0, "some posts on the page have answers");
  check(mismatches.length === 0, "every answered post shows its answer " + mismatches.slice(0, 5).join("; "));
  return { treatments, actionCounts };
}

function allSentPosts(classifyCalls) {
  return classifyCalls.flatMap((call) => call.posts);
}

function checkBatches(classifyCalls) {
  check(classifyCalls.length > 0, `classify calls were made (${classifyCalls.length})`);
  check(classifyCalls.every((call) => call.posts.length <= 25), "every batch has at most 25 posts");
}

function checkPendingThenDone(classifyCalls) {
  const firstStatusById = new Map();
  let pendingThenDoneCount = 0;
  for (const call of classifyCalls) {
    for (const result of call.results) {
      if (!firstStatusById.has(result.post_id)) {
        firstStatusById.set(result.post_id, result.status);
      } else if (firstStatusById.get(result.post_id) === "pending" && result.status === "done") {
        pendingThenDoneCount = pendingThenDoneCount + 1;
      }
    }
  }
  if (usingMockServer) {
    check(pendingThenDoneCount > 0, `pending posts were asked again and answered (${pendingThenDoneCount})`);
  } else {
    console.log(`    info: ${pendingThenDoneCount} posts went from pending to done`);
  }
}

// A post the server finished with must never be sent again: not in this page, and not after a reload
// (the background worker's session cache answers it).
function checkNoResends(classifyCalls) {
  const doneIds = new Set();
  const resentIds = [];
  for (const call of classifyCalls) {
    for (const post of call.posts) {
      if (doneIds.has(post.post_id)) {
        resentIds.push(post.post_id);
      }
    }
    for (const result of call.results) {
      if (result.status === "done") {
        doneIds.add(result.post_id);
      }
    }
  }
  check(resentIds.length === 0, "no post was sent again after it was answered " + resentIds.slice(0, 5).join(" "));
}

function checkActedOn(actionCounts, what) {
  if (usingMockServer) {
    check(actionCounts.blur > 0, `at least one ${what} is blurred`);
    check(actionCounts.hide > 0, `at least one ${what} is hidden`);
  } else {
    console.log(`    info: ${actionCounts.blur} blurred, ${actionCounts.hide} hidden`);
  }
}

async function waitForAnswersToSettle(page, classifyCalls) {
  await waitUntil(() => classifyCalls.length > 0, 20000);
  // The mock answers pending first and the extension asks again after 2 seconds.
  await waitUntil(async () => (await page.locator('[data-brainrot-index-action="pending"]').count()) === 0, 20000);
  await page.waitForTimeout(1000);
}

// Shared body of the Reddit and X feed tests.
async function checkFeed(page, serviceWorker, classifyCalls, platform, feedUrl) {
  await page.goto(feedUrl, { waitUntil: "domcontentloaded" });
  await waitForAnswersToSettle(page, classifyCalls);

  const feedPosts = allSentPosts(classifyCalls).filter((post) => post.kind === "post");
  check(feedPosts.length > 0, `feed posts were sent (${feedPosts.length})`);
  check(feedPosts.every((post) => post.platform === platform && post.post_id !== "" && post.url !== ""),
    "every record has platform, post id and url");
  check(feedPosts.every((post) => post.text !== "" || post.image_urls.length > 0), "every record has text or images");
  if (platform === "reddit") {
    check(feedPosts.every((post) => post.text !== ""), "every Reddit record has a title");
  }
  console.log("    sample record: " + JSON.stringify(feedPosts[0]).slice(0, 400));
  checkBatches(classifyCalls);
  checkPendingThenDone(classifyCalls);
  const beforeScroll = await checkPageMatchesAnswers(page, serviceWorker, platform);

  const sentBeforeScroll = new Set(allSentPosts(classifyCalls).map((post) => post.post_id));
  await scrollDown(page, 6);
  await waitForAnswersToSettle(page, classifyCalls);
  const newlySent = allSentPosts(classifyCalls).filter((post) => !sentBeforeScroll.has(post.post_id));
  check(newlySent.length > 0, `scrolling sent new posts (${newlySent.length})`);
  const afterScroll = await checkPageMatchesAnswers(page, serviceWorker, platform);
  checkActedOn({
    blur: beforeScroll.actionCounts.blur + afterScroll.actionCounts.blur,
    hide: beforeScroll.actionCounts.hide + afterScroll.actionCounts.hide,
  }, "post");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  checkNoResends(classifyCalls);
}

// Shared body of the Reddit comments and X replies tests.
async function checkReplies(page, serviceWorker, classifyCalls, platform, threadUrl) {
  const callsBefore = classifyCalls.length;
  await page.goto(threadUrl, { waitUntil: "domcontentloaded" });
  await waitForAnswersToSettle(page, classifyCalls);
  await scrollDown(page, 3);
  await waitForAnswersToSettle(page, classifyCalls);

  const replies = allSentPosts(classifyCalls.slice(callsBefore)).filter((post) => post.kind === "reply");
  check(replies.length > 0, `replies were sent with kind "reply" (${replies.length})`);
  check(replies.every((post) => post.parent_post_id !== undefined && post.parent_post_id !== ""), "every reply has a parent_post_id");
  console.log("    sample reply: " + JSON.stringify(replies[0]).slice(0, 400));
  const { actionCounts } = await checkPageMatchesAnswers(page, serviceWorker, platform);
  checkActedOn(actionCounts, "reply or post");
  checkNoResends(classifyCalls);
}

async function testExtensionLoads(serviceWorker, extensionId, context) {
  check(serviceWorker.url().endsWith("/background.js"), "service worker is running: " + serviceWorker.url());
  // The defaults are written by the worker's install handler, which may still be running.
  await waitUntil(async () => (await serviceWorker.evaluate(() => chrome.storage.local.get("serverAddress"))).serverAddress !== undefined, 5000);
  const stored = await serviceWorker.evaluate(() => chrome.storage.local.get(null));
  check(stored.serverAddress === DEFAULT_SERVER_ADDRESS, "default server address is " + DEFAULT_SERVER_ADDRESS);
  check(stored.extensionEnabled === true, "filtering is on by default");
  const optionsPage = await context.newPage();
  await optionsPage.goto(`chrome-extension://${extensionId}/options/options.html`);
  await optionsPage.waitForTimeout(500);
  check(await optionsPage.inputValue("#server-address") === DEFAULT_SERVER_ADDRESS, "options page shows the default address");
  await optionsPage.close();
}

async function readPopupStatus(context, extensionId) {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.waitForTimeout(1500);
  const statusText = await popupPage.textContent("#account-status");
  await popupPage.close();
  return statusText;
}

async function testConnectFlow(serviceWorker, extensionId, context) {
  await serviceWorker.evaluate((address) => chrome.storage.local.set({ serverAddress: address }), serverAddress);
  check(await readPopupStatus(context, extensionId) !== "Connected to your account", "popup shows not connected before connecting");
  const sitePage = await context.newPage();
  await sitePage.goto(serverAddress + "/");
  await sitePage.waitForTimeout(1000);
  await sitePage.click("#connect-button");
  await waitUntil(async () => (await sitePage.textContent("#connect-status")) === "Extension connected", 5000);
  check(await sitePage.textContent("#connect-status") === "Extension connected", "site received the connected reply");
  await sitePage.close();
  const stored = await serviceWorker.evaluate(() => chrome.storage.local.get("token"));
  check(stored.token === MOCK_TOKEN, "token is stored");
  check(await readPopupStatus(context, extensionId) === "Connected to your account", "popup shows connected");
}

// Samples the page's JavaScript while scrolling and adds up time spent in the extension's code,
// including the browser functions it calls. Also records the page's long tasks (over 50 ms).
async function testScrollPerformance(context, serviceWorker, extensionId, classifyCalls) {
  // Empty the answer cache so every post in this page goes through the full path.
  await serviceWorker.evaluate(() => chrome.storage.session.clear());
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.longTasksSeen = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.longTasksSeen.push(Math.round(entry.duration));
      }
    }).observe({ type: "longtask", buffered: true });
  });
  await page.goto("https://www.reddit.com/r/popular/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 }); // microseconds
  await cdp.send("Profiler.start");
  const callsBefore = classifyCalls.length;
  for (let step = 0; step < 15; step++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(16000); // let pending retries finish inside the profile
  const postsSent = new Set(allSentPosts(classifyCalls.slice(callsBefore)).map((post) => post.post_id)).size;
  const { profile } = await cdp.send("Profiler.stop");
  const longTasks = await page.evaluate(() => window.longTasksSeen);
  await page.close();

  const extensionUrlPrefix = `chrome-extension://${extensionId}/`;
  const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
  const parentById = new Map();
  for (const node of profile.nodes) {
    for (const childId of node.children ?? []) {
      parentById.set(childId, node.id);
    }
  }
  const inExtensionById = new Map();
  function isInExtension(nodeId) {
    if (inExtensionById.has(nodeId)) {
      return inExtensionById.get(nodeId);
    }
    const node = nodeById.get(nodeId);
    let inExtension = node.callFrame.url.startsWith(extensionUrlPrefix);
    if (!inExtension && parentById.has(nodeId)) {
      inExtension = isInExtension(parentById.get(nodeId));
    }
    inExtensionById.set(nodeId, inExtension);
    return inExtension;
  }

  let extensionMicroseconds = 0;
  let longestExtensionStretch = 0;
  let currentStretch = 0;
  for (let sampleIndex = 0; sampleIndex < profile.samples.length; sampleIndex++) {
    const sampleMicroseconds = profile.timeDeltas[sampleIndex + 1] ?? 0;
    if (isInExtension(profile.samples[sampleIndex])) {
      extensionMicroseconds = extensionMicroseconds + sampleMicroseconds;
      currentStretch = currentStretch + sampleMicroseconds;
      longestExtensionStretch = Math.max(longestExtensionStretch, currentStretch);
    } else {
      currentStretch = 0;
    }
  }

  const postsHandled = Math.max(postsSent, 1);
  console.log(`    posts sent while profiling: ${postsSent}`);
  console.log(`    extension JavaScript time: ${(extensionMicroseconds / 1000).toFixed(1)} ms total, `
    + `${(extensionMicroseconds / 1000 / postsHandled).toFixed(2)} ms per post`);
  console.log(`    longest uninterrupted stretch in extension code: ${(longestExtensionStretch / 1000).toFixed(1)} ms`);
  console.log(`    page long tasks while scrolling (all causes): ${longTasks.length} ${JSON.stringify(longTasks.slice(0, 20))}`);
  check(longestExtensionStretch < 50000, "no stretch of extension code reaches 50 ms");
}

async function runRedditGroup() {
  const { context, serviceWorker, extensionId } = await launchBrave(makeFreshProfileDir("reddit"));
  try {
    const classifyCalls = recordClassifyCalls(context);
    const feedbackCalls = recordFeedbackCalls(context);
    const page = context.pages()[0] ?? (await context.newPage());

    await runTest("1. extension loads, service worker starts, default options", () =>
      testExtensionLoads(serviceWorker, extensionId, context));
    if (usingMockServer) {
      await runTest("2. connect flow stores the token, popup shows connected", () =>
        testConnectFlow(serviceWorker, extensionId, context));
    } else {
      await configureExtension(serviceWorker);
    }
    await runTest("3a. Reddit feed", () =>
      checkFeed(page, serviceWorker, classifyCalls, "reddit", "https://www.reddit.com/r/popular/"));
    await runTest("6a. feedback: Wrong? control on a filtered post", () => testReportWrongControl(page, feedbackCalls));
    await runTest("6b. feedback: missed post menu item", () => testMissedPostMenuItem(page, serviceWorker, feedbackCalls));
    await runTest("6c. feedback: popup text box", () => testPopupFeedbackBox(context, extensionId, feedbackCalls));
    await runTest("3b. Reddit comments", async () => {
      await page.goto("https://www.reddit.com/r/AskReddit/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      const threadPath = await page.evaluate(() => {
        const posts = [...document.querySelectorAll("shreddit-post")];
        posts.sort((a, b) => Number(b.getAttribute("comment-count")) - Number(a.getAttribute("comment-count")));
        return posts[0].getAttribute("permalink");
      });
      await checkReplies(page, serviceWorker, classifyCalls, "reddit", "https://www.reddit.com" + threadPath);
    });
    await runTest("5. scroll performance on Reddit", () => testScrollPerformance(context, serviceWorker, extensionId, classifyCalls));
  } finally {
    await context.close();
  }
}

async function runXGroup() {
  const { context, serviceWorker } = await launchBrave(X_TEST_PROFILE_DIR, { signedInProfile: true });
  try {
    await configureExtension(serviceWorker);
    await serviceWorker.evaluate(() => chrome.storage.session.clear());
    const classifyCalls = recordClassifyCalls(context);
    const page = context.pages()[0] ?? (await context.newPage());

    await runTest("4a. X home feed", () =>
      checkFeed(page, serviceWorker, classifyCalls, "x", "https://x.com/home"));
    await runTest("4b. X replies", async () => {
      await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      // The tweet with the most replies, read from the reply button's label ("123 Replies. Reply").
      const statusPath = await page.evaluate(() => {
        let bestPath = null;
        let mostReplies = -1;
        for (const tweet of document.querySelectorAll('article[data-testid="tweet"]')) {
          const replyCount = parseInt(tweet.querySelector('[data-testid="reply"]')?.getAttribute("aria-label") ?? "0", 10) || 0;
          const timeLink = tweet.querySelector("a[href*='/status/'] time")?.closest("a");
          if (timeLink && replyCount > mostReplies) {
            mostReplies = replyCount;
            bestPath = timeLink.getAttribute("href");
          }
        }
        return bestPath;
      });
      await checkReplies(page, serviceWorker, classifyCalls, "x", "https://x.com" + statusPath);
    });
  } finally {
    await context.close();
  }
}

function pgrepFinds(pattern) {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).trim() !== "";
  } catch (noMatch) {
    return false; // pgrep exits with status 1 when nothing matches
  }
}

const requestedGroups = process.argv.slice(2);
const groupsToRun = requestedGroups.length > 0 ? requestedGroups : ["reddit", "x"];
const mockServer = usingMockServer ? await startMockServer(MOCK_PORT) : null;
console.log("server: " + serverAddress + (usingMockServer ? " (mock)" : ""));
try {
  if (groupsToRun.includes("x")) {
    if (pgrepFinds(X_TEST_PROFILE_DIR)) {
      testResults.push({ name: "4. X", passed: false, error: "the X test profile is open in another Brave window" });
    } else {
      await runXGroup();
    }
  }
  if (groupsToRun.includes("reddit")) {
    await runRedditGroup();
  }
} finally {
  if (mockServer !== null) {
    mockServer.close();
  }
}

console.log("\n== summary");
for (const result of testResults) {
  console.log((result.passed ? "PASS " : "FAIL ") + result.name + (result.passed ? "" : ": " + result.error));
}
process.exitCode = testResults.every((result) => result.passed) ? 0 : 1;
