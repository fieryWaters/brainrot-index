// End-to-end tests of the extension in headed Brave against live Reddit and X.
//
// Usage:
//   node run-tests.mjs [reddit] [x]
//     Runs the named groups (both when none are named) against the mock server, which it starts.
//   BRAINROT_SERVER=https://brainrot.jacob-waters.com BRAINROT_TOKEN=<token> node run-tests.mjs
//     Runs against a real server. The connect test is skipped (the real site needs a login), and the
//     checks that depend on the mock's fixed rules (pending first, at least one blur and one hide)
//     are reported instead of asserted. For each surface it prints what the server decided.
//   Adding BRAINROT_SESSION_COOKIE=<sessionid> BRAINROT_CSRF_TOKEN=<csrftoken> (a logged-in website
//     session for the same account) also runs the real "Connect extension" button on the dashboard,
//     and checks that a plugin threshold and child mode, changed through the API, take effect.
//   BRAINROT_ONLY=4g node run-tests.mjs x
//     Runs only the tests whose names start with "4g".
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
const sessionCookie = process.env.BRAINROT_SESSION_COOKIE;
const csrfToken = process.env.BRAINROT_CSRF_TOKEN;

// Lets Playwright see the extension service worker's fetches, so tests can read every classify call.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const testResults = [];

function check(condition, description) {
  if (!condition) {
    throw new Error("check failed: " + description);
  }
  console.log("    ok: " + description);
}

// BRAINROT_ONLY=<prefix> runs only the tests whose names start with that prefix (connect steps always run).
async function runTest(name, testFunction) {
  const onlyPrefix = process.env.BRAINROT_ONLY;
  if (onlyPrefix !== undefined && !name.startsWith(onlyPrefix) && !name.startsWith("2.")) {
    return;
  }
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
// sentAt and answeredAt are milliseconds since the epoch, taken when the request left and when its
// answer arrived.
function recordClassifyCalls(context) {
  const classifyCalls = [];
  const sentAtByRequest = new WeakMap();
  context.on("request", (request) => {
    sentAtByRequest.set(request, Date.now());
  });
  context.on("requestfinished", async (request) => {
    if (!request.url().endsWith("/api/classify/")) {
      return;
    }
    const answeredAt = Date.now();
    const response = await request.response();
    const call = {
      posts: request.postDataJSON().posts,
      results: [],
      status: response.status(),
      sentAt: sentAtByRequest.get(request),
      answeredAt: answeredAt,
    };
    if (response.ok()) {
      call.results = (await response.json()).results;
    } else {
      console.log(`    classify answered ${response.status()}: ` + (await response.text()).slice(0, 200));
    }
    classifyCalls.push(call);
  });
  return classifyCalls;
}

// What the server decided for the posts sent during one test: counts, timing, plugins, examples.
// The time is from the first request carrying a post to the answer that finished it; the extension
// adds up to 150 ms of batching before that and applies the action as soon as the answer arrives.
function reportServerDecisions(surfaceName, classifyCalls) {
  const postById = new Map();
  const firstSentAtById = new Map();
  const doneResultById = new Map();
  const doneAtById = new Map();
  let doneOnFirstAsk = 0;
  for (const call of classifyCalls) {
    for (const post of call.posts) {
      postById.set(post.post_id, post);
      if (!firstSentAtById.has(post.post_id)) {
        firstSentAtById.set(post.post_id, call.sentAt);
      }
    }
    for (const result of call.results) {
      if (result.status !== "done" || doneResultById.has(result.post_id)) {
        continue;
      }
      if (firstSentAtById.get(result.post_id) === call.sentAt) {
        doneOnFirstAsk = doneOnFirstAsk + 1;
      }
      doneResultById.set(result.post_id, result);
      doneAtById.set(result.post_id, call.answeredAt);
    }
  }
  const waits = [...doneAtById.entries()].map(([postId, doneAt]) => doneAt - firstSentAtById.get(postId)).sort((a, b) => a - b);
  const flaggedCountByPlugin = {};
  const flaggedExamples = [];
  for (const result of doneResultById.values()) {
    if (result.action === "allow") {
      continue;
    }
    const topReason = result.reasons[0];
    const key = `${topReason.plugin} (${result.action})`;
    flaggedCountByPlugin[key] = (flaggedCountByPlugin[key] ?? 0) + 1;
    flaggedExamples.push(`${topReason.plugin} ${topReason.score} ${result.action}: ` + postById.get(result.post_id).text.replace(/\s+/g, " ").slice(0, 80));
  }
  console.log(`\n    -- server decisions: ${surfaceName}`);
  const failedCalls = classifyCalls.filter((call) => call.status !== 200).length;
  console.log(`    posts sent: ${postById.size}; done: ${doneResultById.size}; done on the first ask: ${doneOnFirstAsk}; classify calls: ${classifyCalls.length}, failed: ${failedCalls}`);
  if (waits.length > 0) {
    console.log(`    first send to done: median ${waits[Math.floor(waits.length / 2)]} ms, worst ${waits[waits.length - 1]} ms`);
  }
  console.log(`    flagged: ${JSON.stringify(flaggedCountByPlugin)}`);
  for (const example of flaggedExamples.slice(0, 4)) {
    console.log("      " + example);
  }
}

// Website API calls made as the logged-in test account, for the settings checks.
async function callWebsiteApi(method, path, body) {
  const response = await fetch(serverAddress + path, {
    method: method,
    headers: {
      "Cookie": `sessionid=${sessionCookie}; csrftoken=${csrfToken}`,
      "X-CSRFToken": csrfToken,
      "Content-Type": "application/json",
      "Referer": serverAddress + "/dashboard",
      "Origin": serverAddress,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  check(response.ok, `${method} ${path} answered ${response.status}`);
  return response.json();
}

// The dashboard's "Connect extension" button, clicked in the browser with the test account's session
// cookies added to the profile. No password is typed anywhere.
async function testRealConnectFlow(context, serviceWorker, extensionId) {
  await serviceWorker.evaluate(async (address) => {
    await chrome.storage.local.set({ serverAddress: address });
    await chrome.storage.local.remove("token");
  }, serverAddress);
  const siteHost = new URL(serverAddress).hostname;
  await context.addCookies([
    { name: "sessionid", value: sessionCookie, domain: siteHost, path: "/", secure: true, httpOnly: true, sameSite: "Lax" },
    { name: "csrftoken", value: csrfToken, domain: siteHost, path: "/", secure: true, sameSite: "Lax" },
  ]);
  const dashboardPage = await context.newPage();
  await dashboardPage.goto(serverAddress + "/dashboard", { waitUntil: "domcontentloaded" });
  const connectButton = dashboardPage.getByRole("button", { name: "Connect extension" });
  await connectButton.waitFor({ timeout: 15000 });
  await connectButton.click();
  const connectedText = dashboardPage.getByText("Connected", { exact: true });
  await connectedText.waitFor({ timeout: 10000 });
  check(await connectedText.isVisible(), "the dashboard shows Connected");
  await dashboardPage.close();
  const stored = await serviceWorker.evaluate(() => chrome.storage.local.get("token"));
  check(typeof stored.token === "string" && stored.token.length > 0, "the extension stored a token");
  check(await readPopupStatus(context, extensionId) === "Connected to your account", "popup shows connected");
}

function countFilteredAnswers(classifyCalls) {
  const actionById = new Map();
  for (const call of classifyCalls) {
    for (const result of call.results) {
      if (result.status === "done") {
        actionById.set(result.post_id, result.action);
      }
    }
  }
  let filteredCount = 0;
  for (const action of actionById.values()) {
    if (action !== "allow") {
      filteredCount = filteredCount + 1;
    }
  }
  return { answeredCount: actionById.size, filteredCount };
}

// Lowering one plugin's threshold on the website must filter more of the same feed.
async function testThresholdTakesEffect(page, serviceWorker, classifyCalls, feedUrl) {
  const { plugins } = await callWebsiteApi("GET", "/api/plugins/");
  const plugin = plugins.find((candidate) => candidate.enabled);
  console.log(`    plugins: ${plugins.map((candidate) => `${candidate.slug} ${candidate.threshold} ${candidate.flagged_action}${candidate.enabled ? "" : " (off)"}`).join(", ")}`);

  async function filteredOnFreshLoad() {
    await serviceWorker.evaluate(() => chrome.storage.session.clear());
    const callsBefore = classifyCalls.length;
    await page.goto(feedUrl, { waitUntil: "domcontentloaded" });
    await waitForAnswersToSettle(page, classifyCalls);
    await scrollDown(page, 2);
    await waitForAnswersToSettle(page, classifyCalls);
    return countFilteredAnswers(classifyCalls.slice(callsBefore));
  }

  const before = await filteredOnFreshLoad();
  await callWebsiteApi("PATCH", `/api/plugins/${plugin.slug}/`, { threshold: 20 });
  let after;
  try {
    after = await filteredOnFreshLoad();
  } finally {
    await callWebsiteApi("PATCH", `/api/plugins/${plugin.slug}/`, { threshold: 60 });
  }
  console.log(`    ${plugin.slug} at ${plugin.threshold}: ${before.filteredCount} of ${before.answeredCount} filtered; at 20: ${after.filteredCount} of ${after.answeredCount}`);
  check(after.filteredCount / Math.max(after.answeredCount, 1) > before.filteredCount / Math.max(before.answeredCount, 1),
    "a lower threshold filters a larger share of posts");
}

// Child mode: pending posts are blurred and blurred posts cannot be revealed.
async function testChildMode(page, serviceWorker, classifyCalls, feedUrl) {
  await callWebsiteApi("PATCH", "/api/settings/", { mode: "child" });
  try {
    await serviceWorker.evaluate(() => chrome.storage.session.clear());
    const status = await serviceWorker.evaluate(() => getStatus());
    console.log("    config in child mode: " + JSON.stringify(status.config));
    check(status.config.pending_action === "blur" && status.config.allow_reveal === false, "the server config says blur while pending and no reveal");
    await page.goto(feedUrl, { waitUntil: "domcontentloaded" });
    const sawPending = await waitUntil(async () => (await page.locator('[data-brainrot-index-action="pending"]').count()) > 0, 10000);
    check(sawPending, "posts are blurred while pending");
    await waitForAnswersToSettle(page, classifyCalls);
    await scrollDown(page, 3);
    await waitForAnswersToSettle(page, classifyCalls);
    const blurLabels = await page.locator(".brainrot-index-notice-over-post").allTextContents();
    console.log(`    blur labels in child mode: ${blurLabels.length}`);
    check(blurLabels.every((label) => !label.includes("click to show")), "no blur label offers click to show");
    const blurredPost = page.locator('[data-brainrot-index-action="blur"]').first();
    if (await blurredPost.count() === 1) {
      await blurredPost.click({ position: { x: 40, y: 60 } });
      await page.waitForTimeout(500);
      check(await blurredPost.getAttribute("data-brainrot-index-action") === "blur", "clicking a blurred post does not reveal it");
    } else {
      console.log("    info: no blurred post to click");
    }
  } finally {
    await callWebsiteApi("PATCH", "/api/settings/", { mode: "adult" });
  }
}

// Starts the extension on the server under test: the mock's connect page, the real dashboard, or a
// token passed in the environment.
async function connectExtension(context, serviceWorker, extensionId, groupName) {
  // The worker's install handler writes the default address; settings written before it finishes are lost.
  await waitUntil(async () => (await serviceWorker.evaluate(() => chrome.storage.local.get("serverAddress"))).serverAddress !== undefined, 5000);
  if (usingMockServer) {
    await runTest(`2. ${groupName}: connect flow stores the token, popup shows connected`, () =>
      testConnectFlow(serviceWorker, extensionId, context));
  } else if (sessionCookie !== undefined) {
    await runTest(`2. ${groupName}: real dashboard Connect extension button`, () =>
      testRealConnectFlow(context, serviceWorker, extensionId));
  } else {
    await configureExtension(serviceWorker);
  }
}

// Runs one surface's test and, against a real server, prints what the server decided during it.
async function runSurfaceTest(name, classifyCalls, testFunction) {
  const callsBefore = classifyCalls.length;
  await runTest(name, testFunction);
  if (!usingMockServer) {
    reportServerDecisions(name, classifyCalls.slice(callsBefore));
  }
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

// Unfiltered post elements on each site, for the tests. Selectors repeat the adapters' on purpose.
const UNFILTERED_POST_SELECTOR = {
  reddit: "shreddit-post:not([data-brainrot-index-action])",
  x: 'article[data-testid="tweet"]:not([data-brainrot-index-action]):has(a[href*="/status/"] time)',
};

// Runs in the page: the site's id for a post element.
function readPostIdInPage(postElement, platform) {
  if (platform === "reddit") {
    return postElement.id;
  }
  return postElement.querySelector("a[href*='/status/'] time").closest("a").getAttribute("href").split("/")[3];
}

// One click on a blurred or hidden post's "Wrong?" control reports it as wrongly filtered.
async function testReportWrongControl(page, feedbackCalls, platform) {
  const reportWrongButton = page.locator(".brainrot-index-report-wrong").first();
  check(await reportWrongButton.count() === 1, "a filtered post shows a Wrong? control");
  const reportedPost = await reportWrongButton.evaluate((button, [platform, readPostIdSource]) => {
    const readPostId = new Function("return " + readPostIdSource)();
    const postElement = button.parentElement.nextElementSibling;
    return { id: readPostId(postElement, platform), action: postElement.dataset.brainrotIndexAction };
  }, [platform, readPostIdInPage.toString()]);
  const callsBefore = feedbackCalls.length;
  await reportWrongButton.scrollIntoViewIfNeeded();
  await reportWrongButton.click();
  await waitUntil(() => feedbackCalls.length > callsBefore, 5000);
  checkFeedbackCall(feedbackCalls[callsBefore], {
    platform: platform,
    post_id: reportedPost.id,
    shown_action: reportedPost.action,
    expected_action: "allow",
    page_url: page.url(),
  });
  check(await reportWrongButton.textContent() === "Recorded", "the label confirms it was recorded");
}

// The context menu item cannot be clicked from a test, so the test right-clicks a post (a contextmenu
// event) and then runs the worker function the menu item calls.
async function testMissedPostMenuItem(page, serviceWorker, feedbackCalls, platform) {
  const unfilteredPost = page.locator(UNFILTERED_POST_SELECTOR[platform]).first();
  for (let step = 0; step < 6 && (await unfilteredPost.count()) === 0; step++) {
    await scrollDown(page, 1);
  }
  check(await unfilteredPost.count() === 1, "an unfiltered post is on the page");
  const postId = await unfilteredPost.evaluate(readPostIdInPage, platform);
  await unfilteredPost.dispatchEvent("contextmenu");
  const callsBefore = feedbackCalls.length;
  await serviceWorker.evaluate(async (pageUrl) => {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return reportMissedPost(activeTab.id, 0, pageUrl);
  }, page.url());
  await waitUntil(() => feedbackCalls.length > callsBefore, 5000);
  checkFeedbackCall(feedbackCalls[callsBefore], {
    platform: platform,
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
    // A post answered "hide" while above the viewport is blurred instead, so nothing visible moves.
    const blurredInsteadOfHidden = answer.action === "hide" && treatment.action === "blur";
    if (answer.action !== treatment.action && !blurredInsteadOfHidden) {
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
  check(classifyCalls.every((call) => call.status === 200), "every classify call succeeded");
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
  // The mock answers pending first and the extension asks again after half a second.
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

// Content the reader is looking at must not move when answers arrive. The test loads a feed with the
// extension switched off, scrolls down, then switches it on, so the posts above the viewport are marked
// pending and answered while the reader looks further down. It follows one visible post's position.
async function testScrollStability(context, page, serviceWorker, platform, feedUrl) {
  const postSelector = platform === "reddit" ? "shreddit-post" : 'article[data-testid="tweet"]';
  await serviceWorker.evaluate(() => chrome.storage.session.clear());
  await serviceWorker.evaluate(() => chrome.storage.local.set({ extensionEnabled: false }));
  await page.goto(feedUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(1500);

  // Runs in the page: numbers the posts in the viewport, below the top 120 px.
  const watchedCount = await page.evaluate((selector) => {
    let index = 0;
    for (const post of document.querySelectorAll(selector)) {
      const top = post.getBoundingClientRect().top;
      if (top > 120 && top < window.innerHeight) {
        post.dataset.testWatched = String(index);
        index = index + 1;
      }
    }
    return index;
  }, postSelector);
  check(watchedCount > 0, `posts are in view to watch (${watchedCount})`);

  await serviceWorker.evaluate(() => chrome.storage.local.set({ extensionEnabled: true }));
  const samples = [];
  for (let sample = 0; sample < 50; sample++) {
    // One entry per watched post still in the page, keyed by its number.
    samples.push(await page.evaluate(() => {
      const positionByNumber = {};
      for (const post of document.querySelectorAll("[data-test-watched]")) {
        const rect = post.getBoundingClientRect();
        positionByNumber[post.dataset.testWatched] = { top: Math.round(rect.top), hidden: rect.height === 0 };
      }
      return positionByNumber;
    }));
    await page.waitForTimeout(100);
  }

  // The reader watches the highest post in view that stays visible. A post in view collapsing above it
  // moves it legitimately (the reader saw that post collapse), so that case is reported, not judged.
  const neverHidden = (index) => samples.every((sample) => sample[index] !== undefined && !sample[index].hidden);
  let watchedIndex = 0;
  while (watchedIndex < watchedCount && !neverHidden(watchedIndex)) {
    watchedIndex = watchedIndex + 1;
  }
  if (watchedIndex === watchedCount) {
    console.log("    info: every post in view was hidden or removed, so there was nothing to watch; run again");
    return;
  }
  const tops = samples.map((sample) => sample[watchedIndex].top);
  const largestMove = Math.max(...tops) - Math.min(...tops);
  console.log(`    watched post (${watchedIndex} posts in view above it collapsed) top over 5 s: ${[...new Set(tops)].join(" ")} (moved ${largestMove} px)`);
  if (watchedIndex > 0) {
    console.log("    info: a post in view was hidden while the reader looked at it, so movement is expected");
    return;
  }
  check(largestMove <= 2, "the watched post did not move when answers arrived");
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
  await serviceWorker.evaluate(async (address) => {
    await chrome.storage.local.set({ serverAddress: address });
    await chrome.storage.local.remove("token");
  }, serverAddress);
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
async function testScrollPerformance(context, serviceWorker, extensionId, classifyCalls, feedUrl) {
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
  await page.goto(feedUrl, { waitUntil: "domcontentloaded" });
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
    await connectExtension(context, serviceWorker, extensionId, "Reddit profile");
    await runSurfaceTest("3a. Reddit feed", classifyCalls, () =>
      checkFeed(page, serviceWorker, classifyCalls, "reddit", "https://www.reddit.com/r/popular/"));
    await runTest("6a. feedback: Wrong? control on a filtered post", () => testReportWrongControl(page, feedbackCalls, "reddit"));
    await runTest("6b. feedback: missed post menu item", () => testMissedPostMenuItem(page, serviceWorker, feedbackCalls, "reddit"));
    await runTest("6c. feedback: popup text box", () => testPopupFeedbackBox(context, extensionId, feedbackCalls));
    await runSurfaceTest("3b. Reddit comments", classifyCalls, async () => {
      await page.goto("https://www.reddit.com/r/AskReddit/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      const threadPath = await page.evaluate(() => {
        const posts = [...document.querySelectorAll("shreddit-post")];
        posts.sort((a, b) => Number(b.getAttribute("comment-count")) - Number(a.getAttribute("comment-count")));
        return posts[0].getAttribute("permalink");
      });
      await checkReplies(page, serviceWorker, classifyCalls, "reddit", "https://www.reddit.com" + threadPath);
    });
    await runTest("3c. Reddit scroll stability", () =>
      testScrollStability(context, page, serviceWorker, "reddit", "https://www.reddit.com/r/popular/"));
    await runTest("5. scroll performance on Reddit", () => testScrollPerformance(context, serviceWorker, extensionId, classifyCalls, "https://www.reddit.com/r/popular/"));
    if (!usingMockServer && sessionCookie !== undefined) {
      await runTest("7a. a lower plugin threshold filters more", () =>
        testThresholdTakesEffect(page, serviceWorker, classifyCalls, "https://www.reddit.com/r/popular/"));
      await runTest("7b. child mode blurs pending posts and removes reveal", () =>
        testChildMode(page, serviceWorker, classifyCalls, "https://www.reddit.com/r/popular/"));
    }
  } finally {
    await context.close();
  }
}

// X removes tweets far from the viewport and creates new elements when they scroll back. The test marks
// the elements it saw, scrolls far down and back up, and checks that newly created elements for
// already-answered tweets show their answers again without a new request.
async function testXRecycledTweets(page, serviceWorker, classifyCalls) {
  await page.evaluate(() => {
    for (const tweet of document.querySelectorAll('article[data-testid="tweet"]')) {
      tweet.dataset.testSeenBefore = "yes";
    }
  });
  const answeredBeforeScroll = await readCachedAnswers(serviceWorker);
  const callsBefore = classifyCalls.length;
  for (let step = 0; step < 12; step++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(700);
  }
  for (let step = 0; step < 14; step++) {
    await page.mouse.wheel(0, -1500);
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(2000);
  const answerById = await readCachedAnswers(serviceWorker);
  const recreated = await page.evaluate(() => [...document.querySelectorAll('article[data-testid="tweet"]:not([data-test-seen-before])')]
    .filter((tweet) => tweet.querySelector("a[href*='/status/'] time") !== null)
    .map((tweet) => ({
      id: tweet.querySelector("a[href*='/status/'] time").closest("a").getAttribute("href").split("/")[3],
      action: tweet.dataset.brainrotIndexAction ?? "allow",
    })));
  const recreatedAnswered = recreated.filter((tweet) => answerById.has(tweet.id));
  console.log(`    recreated tweet elements: ${recreated.length}, of which answered before: ${recreatedAnswered.length}`);
  check(recreatedAnswered.length > 0, "some answered tweets were removed and created again by X");
  const wrong = recreatedAnswered.filter((tweet) => answerById.get(tweet.id).action !== tweet.action);
  check(wrong.length === 0, "every recreated tweet shows its answer again " + JSON.stringify(wrong.slice(0, 3)));
  const resent = allSentPosts(classifyCalls.slice(callsBefore)).filter((post) => answeredBeforeScroll.has(post.post_id));
  check(resent.length === 0, "no answered tweet was sent again while scrolling back");
  await checkPageMatchesAnswers(page, serviceWorker, "x");
}

// Runs in the page: the status ids of the tweets above and below the "Discover more" heading, or null
// while the heading is not in the page.
function readTweetsAroundHeading() {
  const heading = document.querySelector('[data-testid="cellInnerDiv"] h2[role="heading"]');
  if (heading === null) {
    return null;
  }
  const before = [];
  const after = [];
  for (const tweet of document.querySelectorAll('article[data-testid="tweet"]')) {
    const timeLink = tweet.querySelector("a[href*='/status/'] time")?.closest("a");
    if (!timeLink) {
      continue;
    }
    const statusId = timeLink.getAttribute("href").split("/")[3];
    if (heading.compareDocumentPosition(tweet) & Node.DOCUMENT_POSITION_FOLLOWING) {
      after.push(statusId);
    } else {
      before.push(statusId);
    }
  }
  return { headingText: heading.textContent, before, after };
}

// On a post's page, tweets under the "Discover more" heading are unrelated posts and must be sent as
// kind "post". The test opens posts with few replies so that heading is reachable.
async function testXDiscoverMore(page, classifyCalls) {
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const statusPaths = await page.evaluate(() => {
    const paths = [];
    for (const tweet of document.querySelectorAll('article[data-testid="tweet"]')) {
      const replyCount = parseInt(tweet.querySelector('[data-testid="reply"]')?.getAttribute("aria-label") ?? "0", 10) || 0;
      const timeLink = tweet.querySelector("a[href*='/status/'] time")?.closest("a");
      if (timeLink && replyCount >= 2 && replyCount <= 12) {
        paths.push(timeLink.getAttribute("href"));
      }
    }
    return paths;
  });
  check(statusPaths.length > 0, "found a post with 2 to 12 replies");
  // Not every post's page has the section, so up to five posts are tried.
  let statusPath = null;
  let tweetsAroundHeading = null;
  for (const candidatePath of statusPaths.slice(0, 5)) {
    statusPath = candidatePath;
    await page.goto("https://x.com" + statusPath, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    for (let step = 0; step < 10 && tweetsAroundHeading === null; step++) {
      tweetsAroundHeading = await page.evaluate(readTweetsAroundHeading);
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(2000);
    }
    if (tweetsAroundHeading !== null) {
      // Bring the tweets below the heading into view and let them be sent.
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(3000);
      tweetsAroundHeading = (await page.evaluate(readTweetsAroundHeading)) ?? tweetsAroundHeading;
      break;
    }
  }
  check(tweetsAroundHeading !== null, "the Discover more heading appeared");
  console.log(`    heading "${tweetsAroundHeading.headingText}": ${tweetsAroundHeading.before.length} tweets above, ${tweetsAroundHeading.after.length} below`);
  const openPostId = statusPath.split("/")[3];
  const sentKindById = new Map(allSentPosts(classifyCalls).map((post) => [post.post_id, post]));
  const sentAfter = tweetsAroundHeading.after.filter((id) => sentKindById.has(id));
  // Tweets older than the open post are the thread it replies to, not replies.
  const sentRepliesBefore = tweetsAroundHeading.before.filter((id) => BigInt(id) > BigInt(openPostId) && sentKindById.has(id));
  check(sentAfter.length > 0, `tweets below the heading were sent (${sentAfter.length})`);
  console.log(`    open post ${openPostId}; sent below the heading: ` + JSON.stringify(sentAfter.map((id) => ({ id, kind: sentKindById.get(id).kind, parent: sentKindById.get(id).parent_post_id }))));
  check(sentAfter.every((id) => sentKindById.get(id).kind === "post" && sentKindById.get(id).parent_post_id === undefined),
    "every tweet below the heading was sent as a post with no parent");
  check(sentRepliesBefore.every((id) => sentKindById.get(id).kind === "reply"), "every newer tweet above the heading was sent as a reply");
}

async function runXGroup() {
  const { context, serviceWorker, extensionId } = await launchBrave(X_TEST_PROFILE_DIR, { signedInProfile: true });
  try {
    await connectExtension(context, serviceWorker, extensionId, "X profile");
    await serviceWorker.evaluate(() => chrome.storage.session.clear());
    const classifyCalls = recordClassifyCalls(context);
    const feedbackCalls = recordFeedbackCalls(context);
    const page = context.pages()[0] ?? (await context.newPage());

    await runSurfaceTest("4a. X home feed", classifyCalls, () =>
      checkFeed(page, serviceWorker, classifyCalls, "x", "https://x.com/home"));
    await runTest("4c. X recycled tweets", () => testXRecycledTweets(page, serviceWorker, classifyCalls));
    await runTest("4d. X feedback: Wrong? control", () => testReportWrongControl(page, feedbackCalls, "x"));
    await runTest("4e. X feedback: missed post menu item", () => testMissedPostMenuItem(page, serviceWorker, feedbackCalls, "x"));
    await runSurfaceTest("4b. X replies", classifyCalls, async () => {
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
    await runTest("4g. X Discover more posts are not replies", () => testXDiscoverMore(page, classifyCalls));
    await runTest("4h. X scroll stability", () => testScrollStability(context, page, serviceWorker, "x", "https://x.com/home"));
    await runTest("4f. scroll performance on X", () =>
      testScrollPerformance(context, serviceWorker, extensionId, classifyCalls, "https://x.com/home"));
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
