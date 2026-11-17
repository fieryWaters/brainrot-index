// End-to-end tests of the extension in headed Brave against live Reddit, X and YouTube.
//
// Usage:
//   node run-tests.mjs [connect] [reddit] [x] [youtube] [transcripts]
//     Runs the named groups (all when none are named) against the mock server, which it starts.
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
import { makeFreshProfileDir, withBrave, launchBraveWithoutExtension, loadExtensionLater, EXTENSION_DIR } from "./browser.mjs";
import { startMockServer, MOCK_TOKEN, MOCK_CONFIG } from "./mock-server.mjs";
import {
  SAMPLE_REDDIT_COMMENTS, SAMPLE_REDDIT_POSTS, SAMPLE_X_TWEETS, SAMPLE_YOUTUBE_VIDEOS, STAND_IN_URLS,
  samplePages, serveStandInPages,
} from "./stand-in-pages.mjs";

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

// BRAINROT_ONLY=<prefix>[,<prefix>...] runs only the tests whose names start with one of those
// prefixes (connect steps always run).
async function runTest(name, testFunction) {
  const onlyPrefixes = process.env.BRAINROT_ONLY?.split(",");
  if (onlyPrefixes !== undefined && !onlyPrefixes.some((prefix) => name.startsWith(prefix)) && !name.startsWith("2.")) {
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
  const answeredWithin = (limitMs) => waits.filter((wait) => wait <= limitMs).length;
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
    console.log(`    answered within 3 s: ${answeredWithin(3000)}, 10 s: ${answeredWithin(10000)}, 30 s: ${answeredWithin(30000)}, 2 min: ${answeredWithin(120000)}`);
  }
  console.log(`    flagged: ${JSON.stringify(flaggedCountByPlugin)}`);
  for (const example of flaggedExamples.slice(0, 6)) {
    console.log("      " + example);
  }
  console.log("    some allowed posts, with their strongest reason:");
  const allowedResults = [...doneResultById.values()].filter((result) => result.action === "allow");
  for (const result of allowedResults.slice(0, 8)) {
    const topReason = result.reasons[0];
    const reasonText = topReason === undefined ? "no reasons" : `${topReason.plugin} ${topReason.score}`;
    console.log(`      ${reasonText}: ` + postById.get(result.post_id).text.replace(/\s+/g, " ").slice(0, 80));
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
    reportServerDecisions(`feed reload, ${plugin.slug} threshold as set`, classifyCalls.slice(callsBefore));
    return countFilteredAnswers(classifyCalls.slice(callsBefore));
  }

  const before = await filteredOnFreshLoad();
  const callsBeforeChange = classifyCalls.length;
  await callWebsiteApi("PATCH", `/api/plugins/${plugin.slug}/`, { threshold: 20 });
  let after;
  try {
    after = await filteredOnFreshLoad();
    // Posts the server had already classified must be re-judged from stored scores: done on the first ask.
    const actionBeforeById = new Map();
    for (const call of classifyCalls.slice(0, callsBeforeChange)) {
      for (const result of call.results) {
        if (result.status === "done") {
          actionBeforeById.set(result.post_id, result.action);
        }
      }
    }
    let alreadyClassified = 0;
    let doneOnFirstAsk = 0;
    let newlyFiltered = 0;
    const askedAfter = new Set();
    for (const call of classifyCalls.slice(callsBeforeChange)) {
      for (const result of call.results) {
        if (askedAfter.has(result.post_id) || !actionBeforeById.has(result.post_id)) {
          askedAfter.add(result.post_id);
          continue;
        }
        askedAfter.add(result.post_id);
        alreadyClassified = alreadyClassified + 1;
        if (result.status === "done") {
          doneOnFirstAsk = doneOnFirstAsk + 1;
          if (actionBeforeById.get(result.post_id) === "allow" && result.action !== "allow") {
            newlyFiltered = newlyFiltered + 1;
          }
        }
      }
    }
    console.log(`    already-classified posts asked again: ${alreadyClassified}, done on the first ask: ${doneOnFirstAsk}, newly filtered: ${newlyFiltered}`);
    check(doneOnFirstAsk === alreadyClassified, "already-classified posts were re-judged at once, without new inference");
  } finally {
    await callWebsiteApi("PATCH", `/api/plugins/${plugin.slug}/`, { threshold: plugin.threshold });
  }
  console.log(`    ${plugin.slug} at ${plugin.threshold}: ${before.filteredCount} of ${before.answeredCount} filtered; at 20: ${after.filteredCount} of ${after.answeredCount}`);
  // Which posts the feed shows changes between loads, so the share is reported rather than judged.
  console.log("    info: compare the filtered shares above; the feed's posts differ between loads");
}

// Child mode: pending posts are blurred and blurred posts cannot be revealed.
async function testChildMode(page, serviceWorker, classifyCalls, feedUrl) {
  await callWebsiteApi("PATCH", "/api/settings/", { mode: "child" });
  try {
    await serviceWorker.evaluate(() => chrome.storage.session.clear());
    const status = await serviceWorker.evaluate(() => getStatus());
    console.log("    config in child mode: " + JSON.stringify(status.config));
    check(status.config.pending_action === "blur" && status.config.allow_reveal === false, "the server config says blur while pending and no reveal");
    const callsBefore = classifyCalls.length;
    await page.goto(feedUrl, { waitUntil: "domcontentloaded" });
    const sawPending = await waitUntil(async () => (await page.locator('[data-brainrot-index-action="pending"]').count()) > 0, 10000);
    const serverSaidPending = classifyCalls.slice(callsBefore).some((call) => call.results.some((result) => result.status === "pending"));
    if (serverSaidPending) {
      check(sawPending, "posts are blurred while pending");
    } else {
      console.log("    info: the server answered every post at once (already classified), so nothing was pending");
    }
    await waitForAnswersToSettle(page, classifyCalls);
    await scrollDown(page, 3);
    await waitForAnswersToSettle(page, classifyCalls);
    console.log(`    labels in child mode: ${await page.locator(".brainrot-index-notice").count()}`);
    check(await page.locator(".brainrot-index-reveal").count() === 0, "no label offers Show");
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

// BRAINROT_SCREENSHOTS_DIR=<folder> saves a picture of each surface centred on a filtered post.
async function saveScreenshotOfFilteredPost(page, fileName) {
  const screenshotsDir = process.env.BRAINROT_SCREENSHOTS_DIR;
  if (screenshotsDir === undefined) {
    return;
  }
  const notice = page.locator(".brainrot-index-notice").first();
  if (await notice.count() === 0) {
    console.log("    info: no filtered post on the page to photograph");
    return;
  }
  await notice.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(1000);
  fs.mkdirSync(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, fileName) });
}

// Runs one surface's test and, against a real server, prints what the server decided during it.
async function runSurfaceTest(name, classifyCalls, testFunction, page) {
  const callsBefore = classifyCalls.length;
  await runTest(name, async () => {
    await testFunction();
    await saveScreenshotOfFilteredPost(page, name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".png");
  });
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

// Every request the extension makes to /api/judgments/: POST for a thumb, PATCH for its details.
function recordJudgmentCalls(context) {
  const judgmentCalls = [];
  context.on("requestfinished", async (request) => {
    if (!request.url().includes("/api/judgments/")) {
      return;
    }
    const response = await request.response();
    judgmentCalls.push({ method: request.method(), url: request.url(), body: request.postDataJSON(), status: response.status() });
  });
  return judgmentCalls;
}

function checkJudgmentCall(judgmentCall, expectedFields) {
  check(judgmentCall !== undefined && judgmentCall.method === "POST", "a judgment was sent");
  console.log("    judgment sent: " + JSON.stringify(judgmentCall.body));
  check(judgmentCall.status === 201 || judgmentCall.status === 200, "the server recorded it");
  check(judgmentCall.body.extension_commit === expectedExtensionCommit(), "extension_commit is " + expectedExtensionCommit());
  for (const [field, value] of Object.entries(expectedFields)) {
    check(judgmentCall.body[field] === value, `${field} is ${value}`);
  }
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
  youtube: 'ytd-page-manager > :not([hidden]) yt-lockup-view-model:not([data-brainrot-index-action]):has(h3 a[href^="/watch?v="]):not(:has([class*="ytLockupViewModelCollection"]))',
};

// Video tiles on YouTube.
const YOUTUBE_TILE_SELECTOR = "yt-lockup-view-model, ytd-video-renderer, ytd-grid-video-renderer, ytm-shorts-lockup-view-model";

// Runs in the page: the site's id for a post element.
function readPostIdInPage(postElement, platform) {
  if (platform === "reddit") {
    return postElement.id;
  }
  if (platform === "youtube") {
    const link = postElement.querySelector('a[href^="/watch?v="], a[href^="/shorts/"]');
    const url = new URL(link.getAttribute("href"), location.origin);
    return url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.split("/")[2];
  }
  return postElement.querySelector("a[href*='/status/'] time").closest("a").getAttribute("href").split("/")[3];
}

// Marks the first post shown with this action that offers Show, scrolls it to the middle of the
// screen, and answers a locator for it. Scrolls further down the feed when there is none yet. Against
// a real server it answers null when there is none, since the server's answers decide the treatments.
async function findPostToReveal(page, action) {
  for (let step = 0; step < 8; step++) {
    const found = await page.evaluate((action) => {
      document.querySelector("[data-test-reveal-target]")?.removeAttribute("data-test-reveal-target");
      for (const element of document.querySelectorAll(`[data-brainrot-index-action="${action}"]:not([data-brainrot-index-revealed])`)) {
        const notice = element.previousElementSibling;
        if (notice !== null && notice.classList.contains("brainrot-index-notice") && notice.querySelector(".brainrot-index-reveal") !== null) {
          element.setAttribute("data-test-reveal-target", "");
          (action === "hide" ? notice : element).scrollIntoView({ block: "center" });
          return true;
        }
      }
      return false;
    }, action);
    if (found) {
      await page.waitForTimeout(800);
      return page.locator("[data-test-reveal-target]");
    }
    await scrollDown(page, 1);
  }
  if (!usingMockServer) {
    return null;
  }
  throw new Error(`check failed: a ${action} post offering Show is on the page`);
}

// The real server's answers decide which treatments a feed has; one that is missing is reported.
function reportMissingTreatment(action) {
  console.log(`    info: no ${action} post offering Show on the page, so this case was not checked`);
}

// Runs in the page: whether the post is drawn, its top, and its blur.
function readPostLook(postElement) {
  return {
    drawn: postElement.getClientRects().length > 0,
    top: postElement.getBoundingClientRect().top,
    filter: getComputedStyle(postElement).filter,
    revealed: postElement.dataset.brainrotIndexRevealed === "true",
    scrollY: window.scrollY,
  };
}

function noticeOf(postLocator) {
  return postLocator.locator("xpath=preceding-sibling::*[1]");
}

// Show on a blurred post's label reveals it where it is, and Blur again blurs it again.
async function testRevealBlurredPost(page) {
  const post = await findPostToReveal(page, "blur");
  if (post === null) {
    reportMissingTreatment("blur");
    return;
  }
  const notice = noticeOf(post);
  const summary = await notice.locator(".brainrot-index-summary").textContent();
  console.log("    label: " + summary);
  check(/^Blurred · .+$/.test(summary), "the label names what was done and the plugin");
  check(await notice.locator(".brainrot-index-reveal").isHidden(), "the label's buttons are hidden until hovered");
  check((await notice.boundingBox()).height <= 30, "the label is one line");
  await notice.hover();
  check(/^.+ · \d+\/100$/.test(await notice.locator(".brainrot-index-detail").textContent()), "hovered, the label adds the plugin's label and score");
  await notice.locator(".brainrot-index-reveal").hover();
  const before = await post.evaluate(readPostLook);
  await notice.locator(".brainrot-index-reveal").click();
  const shown = await post.evaluate(readPostLook);
  check(shown.revealed && shown.filter === "none", "Show reveals the post at once");
  check(Math.abs(shown.top - before.top) <= 2, `the revealed post did not move (${before.top} to ${shown.top})`);
  const blurAgainButton = noticeOf(post).locator(".brainrot-index-reveal");
  check(await blurAgainButton.textContent() === "Blur again", "the label offers Blur again");
  // The line above the revealed post can sit under a site's sticky header, where Playwright would
  // scroll before clicking; the post is brought to the middle of the screen first.
  await post.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  const beforeBlurAgain = await post.evaluate(readPostLook);
  await noticeOf(post).hover();
  await blurAgainButton.click();
  const blurredAgain = await post.evaluate(readPostLook);
  check(!blurredAgain.revealed && blurredAgain.filter.includes("blur"), "Blur again blurs it");
  // Near the top of the page there is no room to scroll up by the height of the removed line.
  if (beforeBlurAgain.scrollY >= 40) {
    check(Math.abs(blurredAgain.top - beforeBlurAgain.top) <= 2, `the post did not move when blurred again (${beforeBlurAgain.top} to ${blurredAgain.top})`);
  } else {
    console.log("    info: the page is at its top, so the post moves up by the removed line");
  }
}

// Show on a hidden post's line expands it, and Hide again collapses it. The keyboard reaches Show.
async function testRevealHiddenPost(page) {
  const post = await findPostToReveal(page, "hide");
  if (post === null) {
    reportMissingTreatment("hide");
    return;
  }
  check(!(await post.evaluate(readPostLook)).drawn, "the hidden post is collapsed");
  const notice = noticeOf(post);
  check(/^Hidden · .+$/.test(await notice.locator(".brainrot-index-summary").textContent()), "the hidden line names the plugin");
  const noticeTopBefore = (await notice.boundingBox()).y;
  await notice.locator(".brainrot-index-reveal").focus();
  await page.keyboard.press("Enter");
  const shown = await post.evaluate(readPostLook);
  check(shown.drawn && shown.revealed, "Show (pressed with the keyboard) expands the hidden post");
  check(Math.abs((await noticeOf(post).boundingBox()).y - noticeTopBefore) <= 2, "the line stayed where it was");
  const hideAgainButton = noticeOf(post).locator(".brainrot-index-reveal");
  check(await hideAgainButton.textContent() === "Hide again", "the line offers Hide again");
  await noticeOf(post).hover();
  await hideAgainButton.click();
  check(!(await post.evaluate(readPostLook)).drawn, "Hide again collapses it");
}

// A click anywhere on a blurred post, also on the site's own link over it, reveals it and does not
// open the post.
async function testClickOnBlurredPost(page) {
  const post = await findPostToReveal(page, "blur");
  if (post === null) {
    reportMissingTreatment("blur");
    return;
  }
  const urlBefore = page.url();
  const box = await post.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
  await page.waitForTimeout(1500);
  check(page.url() === urlBefore, "the click did not open the post");
  check((await post.evaluate(readPostLook)).revealed, "the click revealed the post");
}

// Runs in the page: the element the extension treats for the post with this id, or null.
function findTreatedElementInPage(postId) {
  for (const element of document.querySelectorAll("[data-brainrot-index-action]")) {
    if (element.id === postId || element.id === postId + "-comment-rtjson-content") {
      return element.dataset.brainrotIndexRevealed ?? "no";
    }
    const timeLink = element.querySelector("a[href*='/status/'] time")?.closest("a");
    if (timeLink && timeLink.getAttribute("href").split("/status/")[1].split("/")[0] === postId) {
      return element.dataset.brainrotIndexRevealed ?? "no";
    }
    const videoLink = element.querySelector('a[href^="/watch?v="], a[href^="/shorts/"]');
    if (videoLink && new RegExp("(v=|/shorts/)" + postId + "(&|$)").test(videoLink.getAttribute("href"))) {
      return element.dataset.brainrotIndexRevealed ?? "no";
    }
  }
  return null;
}

// A revealed post is still revealed after it scrolls far away and back, even when the site draws
// it again with a new element.
async function testRevealSurvivesScrolling(page, platform) {
  const post = await findPostToReveal(page, "blur");
  if (post === null) {
    reportMissingTreatment("blur");
    return;
  }
  const postId = await post.evaluate((element, [platform, readPostIdSource]) => {
    const readPostId = new Function("return " + readPostIdSource)();
    if (element.id.endsWith("-comment-rtjson-content")) {
      return element.id.replace("-comment-rtjson-content", "");
    }
    return readPostId(element, platform);
  }, [platform, readPostIdInPage.toString()]);
  await noticeOf(post).hover();
  await noticeOf(post).locator(".brainrot-index-reveal").click();
  check((await post.evaluate(readPostLook)).revealed, "the post is revealed");
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  await scrollDown(page, 8);
  await page.evaluate((scrollY) => window.scrollTo(0, scrollY), scrollYBefore);
  let revealedState = null;
  await waitUntil(async () => {
    revealedState = await page.evaluate(findTreatedElementInPage, postId);
    return revealedState !== null;
  }, 8000);
  check(revealedState === "true", `the post is still revealed after scrolling away and back (${revealedState})`);
}

// With allow_reveal off (child mode on the real server), no label offers Show and a click on a
// blurred post leaves it blurred. Mock server only; the real server's case is test 7b.
async function testNoRevealWhenNotAllowed(page, classifyCalls, feedUrl) {
  MOCK_CONFIG.allow_reveal = false;
  try {
    await page.goto(feedUrl, { waitUntil: "domcontentloaded" });
    await waitForAnswersToSettle(page, classifyCalls);
    const blurredPost = page.locator('[data-brainrot-index-action="blur"]').first();
    check(await page.locator(".brainrot-index-notice").count() > 0, "filtered posts have labels");
    check(await page.locator(".brainrot-index-reveal").count() === 0, "no label offers Show");
    if (await blurredPost.count() === 1) {
      const urlBefore = page.url();
      await blurredPost.scrollIntoViewIfNeeded();
      await blurredPost.click({ position: { x: 40, y: 60 } });
      await page.waitForTimeout(1000);
      check(!(await blurredPost.evaluate(readPostLook)).revealed && page.url() === urlBefore, "a click on a blurred post neither reveals nor opens it");
    }
  } finally {
    MOCK_CONFIG.allow_reveal = true;
  }
}

// Thumbs down on a blurred or hidden post's label saves a judgment at once and opens the details box;
// a severity and details typed there are saved too. The label keeps the post where it was.
async function testJudgeFilteredPost(page, judgmentCalls, platform) {
  const notice = page.locator(".brainrot-index-notice:has(.brainrot-index-judge)").first();
  check(await notice.count() === 1, "a filtered post's label has thumbs");
  const judgedPost = await notice.evaluate((element, [platform, readPostIdSource]) => {
    const readPostId = new Function("return " + readPostIdSource)();
    const postElement = element.nextElementSibling;
    return { id: readPostId(postElement, platform), action: postElement.dataset.brainrotIndexAction };
  }, [platform, readPostIdInPage.toString()]);
  await notice.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const urlBefore = page.url();
  await notice.hover();
  const callsBefore = judgmentCalls.length;
  await notice.locator('.brainrot-index-judge-button[data-verdict="wrong"]').click();
  await waitUntil(() => judgmentCalls.length > callsBefore, 5000);
  checkJudgmentCall(judgmentCalls[callsBefore], {
    platform: platform, post_id: judgedPost.id, verdict: "wrong", shown_action: judgedPost.action,
  });
  const detailsBox = page.locator(".brainrot-index-details");
  check(await waitUntil(async () => (await detailsBox.locator(".brainrot-index-details-status").textContent()).endsWith("saved"), 3000),
    "the details box says the thumb was saved");
  await detailsBox.locator('.brainrot-index-chip[data-value="low"]').click();
  // Real key presses on Reddit and YouTube check that they stay in the box. On X, where single keys
  // like and repost, the text is filled in without key presses so the test account can never act.
  if (platform !== "x") {
    await detailsBox.locator(".brainrot-index-details-input").pressSequentially("automated test: fine post");
  } else {
    await detailsBox.locator(".brainrot-index-details-input").fill("automated test: fine post");
  }
  await detailsBox.locator(".brainrot-index-details-save").click();
  await waitUntil(() => judgmentCalls.length > callsBefore + 1, 5000);
  const detailsCall = judgmentCalls[callsBefore + 1];
  check(detailsCall !== undefined && detailsCall.method === "PATCH", "the details are sent");
  check(detailsCall.body.severity === "low" && detailsCall.body.details === "automated test: fine post", "with the severity and text");
  check(page.url() === urlBefore, "judging did not open the post");
  check(await waitUntil(async () => (await detailsBox.count()) === 0, 3000), "the details box closes");
}

// The context menu item cannot be clicked from a test, so the test right-clicks a post (a contextmenu
// event) and then runs the worker function the menu item calls. It opens the report form over the
// post with Hidden chosen.
async function testMissedPostMenuItem(page, serviceWorker, feedbackCalls, platform) {
  const unfilteredPost = page.locator(UNFILTERED_POST_SELECTOR[platform]).first();
  for (let step = 0; step < 6 && (await unfilteredPost.count()) === 0; step++) {
    await scrollDown(page, 1);
  }
  check(await unfilteredPost.count() === 1, "an unfiltered post is on the page");
  const postId = await unfilteredPost.evaluate(readPostIdInPage, platform);
  await unfilteredPost.dispatchEvent("contextmenu");
  await serviceWorker.evaluate(async (pageUrl) => {
    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return reportMissedPost(activeTab.id, 0, pageUrl);
  }, page.url());
  const form = page.locator(".brainrot-index-report-form").last();
  await form.waitFor({ timeout: 3000 });
  check(await form.locator('.brainrot-index-choice[aria-pressed="true"]').textContent() === "Hidden", "the form opens with Hidden chosen");
  await form.locator(".brainrot-index-choice", { hasText: "Blurred" }).click();
  await form.locator(".brainrot-index-reason").fill("automated test: new kind of bait");
  const callsBefore = feedbackCalls.length;
  await form.locator(".brainrot-index-send").click();
  await waitUntil(() => feedbackCalls.length > callsBefore, 5000);
  checkFeedbackCall(feedbackCalls[callsBefore], {
    platform: platform,
    post_id: postId,
    shown_action: "allow",
    expected_action: "blur",
    text: "automated test: new kind of bait",
  });
  await waitUntil(async () => (await form.count()) === 0, 4000);
  check(await form.count() === 0, "the form closes after it was recorded");
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
  } else if (platform === "youtube") {
    // A tile the extension left untreated counts only once it has been on screen (marked by
    // recordTileTimesInPage). The extension applies an answer to a tile when the tile comes near the
    // screen, so a tile far below, or in a page the reader left, can still show nothing for a video
    // another tile already got an answer for.
    for (const tile of document.querySelectorAll("yt-lockup-view-model, ytd-video-renderer, ytd-grid-video-renderer, ytm-shorts-lockup-view-model")) {
      const page = tile.closest("ytd-browse, ytd-search, ytd-watch-flexy");
      const link = tile.querySelector('a[href^="/watch?v="], a[href^="/shorts/"]');
      if (page === null || page.getClientRects().length === 0 || link === null
          || (tile.dataset.testSeenOnScreen === undefined && tile.dataset.brainrotIndexAction === undefined)) {
        continue;
      }
      const url = new URL(link.getAttribute("href"), location.origin);
      const videoId = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.split("/")[2];
      treatments.push({ id: videoId, action: tile.dataset.brainrotIndexAction ?? "allow" });
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

// A re-ask carries only posts sent before; at most one may be in flight at a time.
function checkReasksDoNotOverlap(classifyCalls) {
  const sentIds = new Set();
  const reasks = [];
  for (const call of [...classifyCalls].sort((a, b) => a.sentAt - b.sentAt)) {
    if (call.posts.every((post) => sentIds.has(post.post_id))) {
      reasks.push(call);
    }
    for (const post of call.posts) {
      sentIds.add(post.post_id);
    }
  }
  const overlapping = reasks.filter((call, index) => index > 0 && call.sentAt < reasks[index - 1].answeredAt);
  check(overlapping.length === 0, `re-asks never overlap (${reasks.length} re-asks)`);
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
  const askCountById = new Map();
  for (const call of classifyCalls) {
    for (const post of call.posts) {
      askCountById.set(post.post_id, (askCountById.get(post.post_id) ?? 0) + 1);
    }
  }
  const askedSevenTimes = [...askCountById.values()].filter((askCount) => askCount >= 7).length;
  const askCountHistogram = {};
  for (const askCount of askCountById.values()) {
    askCountHistogram[askCount] = (askCountHistogram[askCount] ?? 0) + 1;
  }
  console.log("    asks per post: " + JSON.stringify(askCountHistogram));
  if (usingMockServer) {
    check(pendingThenDoneCount > 0, `pending posts were asked again and answered (${pendingThenDoneCount})`);
    check(askedSevenTimes > 0, `slow posts were still asked about after the fast re-asks (${askedSevenTimes})`);
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

// Post ids whose most recent answer was "pending".
function stillPendingIds(classifyCalls) {
  const latestStatusById = new Map();
  for (const call of classifyCalls) {
    for (const result of call.results) {
      latestStatusById.set(result.post_id, result.status);
    }
  }
  return [...latestStatusById].filter(([, status]) => status === "pending").map(([postId]) => postId);
}

async function waitForAnswersToSettle(page, classifyCalls) {
  await waitUntil(() => classifyCalls.length > 0, 20000);
  // The extension keeps asking about pending posts for up to 2 minutes.
  await waitUntil(() => stillPendingIds(classifyCalls).length === 0, usingMockServer ? 40000 : 125000);
  // The mock's slow posts are answered about 24 seconds after they are first sent.
  await waitUntil(async () => (await page.locator('[data-brainrot-index-action="pending"]').count()) === 0, 40000);
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
  const beforeScroll = await checkPageMatchesAnswers(page, serviceWorker, platform);

  const sentBeforeScroll = new Set(allSentPosts(classifyCalls).map((post) => post.post_id));
  await scrollDown(page, 6);
  await waitForAnswersToSettle(page, classifyCalls);
  const newlySent = allSentPosts(classifyCalls).filter((post) => !sentBeforeScroll.has(post.post_id));
  check(newlySent.length > 0, `scrolling sent new posts (${newlySent.length})`);
  checkPendingThenDone(classifyCalls);
  checkReasksDoNotOverlap(classifyCalls);
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
  const postSelectorByPlatform = { reddit: "shreddit-post", x: 'article[data-testid="tweet"]', youtube: YOUTUBE_TILE_SELECTOR };
  const postSelector = postSelectorByPlatform[platform];
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

// The website hands over the token with window.postMessage; answers whether the extension replied.
async function sendTokenFromPage(sitePage) {
  return sitePage.evaluate(() => new Promise((resolve) => {
    function onMessage(event) {
      if (event.data?.type === "brainrot-index-extension-connected") {
        window.removeEventListener("message", onMessage);
        resolve(true);
      }
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "brainrot-index-extension-token", token: "test-token-from-open-tab" }, window.location.origin);
    setTimeout(() => resolve(false), 3000);
  }));
}

// A person usually has the website open before installing the extension, and reloads the extension
// after pulling new code. The browser gives content scripts only to pages loaded afterwards, so the
// extension must add its connect listener to website tabs that are already open.
async function testConnectFromTabOpenedFirst() {
  const context = await launchBraveWithoutExtension(makeFreshProfileDir("open-tab"));
  try {
    const sitePage = context.pages()[0] ?? (await context.newPage());
    await sitePage.goto(DEFAULT_SERVER_ADDRESS + "/", { waitUntil: "domcontentloaded" });
    const extensionId = await loadExtensionLater(context);
    await sitePage.waitForTimeout(2000);
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popupPage.fill("#feedback-text", "Automated test feedback before connecting");
    await popupPage.click("#feedback-form button");
    await waitUntil(async () => (await popupPage.textContent("#feedback-status")) !== "", 3000);
    check(await popupPage.textContent("#feedback-status") === "Not sent. Not connected. Open BrainRot Index and press Connect extension.",
      "popup feedback before connecting says why it was not sent");
    await popupPage.close();
    check(await sendTokenFromPage(sitePage), "a website tab opened before installing gets an answer from the extension");
    await loadExtensionLater(context);
    await sitePage.waitForTimeout(2000);
    check(await sendTokenFromPage(sitePage), "the same tab still gets an answer after the extension is reloaded");
  } finally {
    await context.close();
  }
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
  await withBrave(makeFreshProfileDir("reddit"), {}, async ({ context, serviceWorker, extensionId }) => {
    const classifyCalls = recordClassifyCalls(context);
    const feedbackCalls = recordFeedbackCalls(context);
    const judgmentCalls = recordJudgmentCalls(context);
    const page = context.pages()[0] ?? (await context.newPage());

    await runTest("1. extension loads, service worker starts, default options", () =>
      testExtensionLoads(serviceWorker, extensionId, context));
    await connectExtension(context, serviceWorker, extensionId, "Reddit profile");
    await runSurfaceTest("3a. Reddit feed", classifyCalls, () =>
      checkFeed(page, serviceWorker, classifyCalls, "reddit", "https://www.reddit.com/r/popular/"), page);
    await runTest("6a. feedback: thumbs on a filtered post", () => testJudgeFilteredPost(page, judgmentCalls, "reddit"));
    await runTest("6b. feedback: missed post menu item", () => testMissedPostMenuItem(page, serviceWorker, feedbackCalls, "reddit"));
    await runTest("6c. feedback: popup text box", () => testPopupFeedbackBox(context, extensionId, feedbackCalls));
    await runTest("8a. reveal: Show and Blur again on a blurred Reddit post", () => testRevealBlurredPost(page));
    await runTest("8b. reveal: Show and Hide again on a hidden Reddit post", () => testRevealHiddenPost(page));
    await runTest("8c. reveal: a click on a blurred Reddit post reveals it without opening it", () => testClickOnBlurredPost(page));
    await runTest("8d. reveal: a revealed Reddit post stays revealed after scrolling away and back", () => testRevealSurvivesScrolling(page, "reddit"));
    if (usingMockServer) {
      await runTest("8e. reveal: no Show when the server does not allow it", () =>
        testNoRevealWhenNotAllowed(page, classifyCalls, "https://www.reddit.com/r/popular/"));
    }
    await runSurfaceTest("3b. Reddit comments", classifyCalls, async () => {
      await page.goto("https://www.reddit.com/r/AskReddit/", { waitUntil: "domcontentloaded" });
      await page.locator("shreddit-post").first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(2000);
      const threadPath = await page.evaluate(() => {
        const posts = [...document.querySelectorAll("shreddit-post")];
        posts.sort((a, b) => Number(b.getAttribute("comment-count")) - Number(a.getAttribute("comment-count")));
        return posts[0].getAttribute("permalink");
      });
      await checkReplies(page, serviceWorker, classifyCalls, "reddit", "https://www.reddit.com" + threadPath);
    }, page);
    await runTest("8f. reveal: Show and Blur again in a Reddit comment thread", () => testRevealBlurredPost(page));
    await runTest("8g. reveal: Show and Hide again in a Reddit comment thread", () => testRevealHiddenPost(page));
    await runTest("3c. Reddit scroll stability", () =>
      testScrollStability(context, page, serviceWorker, "reddit", "https://www.reddit.com/r/popular/"));
    await runTest("5. scroll performance on Reddit", () => testScrollPerformance(context, serviceWorker, extensionId, classifyCalls, "https://www.reddit.com/r/popular/"));
    if (!usingMockServer && sessionCookie !== undefined) {
      await runTest("7a. a plugin threshold change is applied at once from stored scores", () =>
        testThresholdTakesEffect(page, serviceWorker, classifyCalls, "https://www.reddit.com/r/popular/"));
      await runTest("7b. child mode blurs pending posts and removes reveal", () =>
        testChildMode(page, serviceWorker, classifyCalls, "https://www.reddit.com/r/popular/"));
    }
  });
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
  // A tweet answered "hide" while above the viewport is blurred instead.
  const wrong = recreatedAnswered.filter((tweet) => {
    const answeredAction = answerById.get(tweet.id).action;
    return answeredAction !== tweet.action && !(answeredAction === "hide" && tweet.action === "blur");
  });
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
  await withBrave(X_TEST_PROFILE_DIR, { signedInProfile: true }, async ({ context, serviceWorker, extensionId }) => {
    await connectExtension(context, serviceWorker, extensionId, "X profile");
    await serviceWorker.evaluate(() => chrome.storage.session.clear());
    const classifyCalls = recordClassifyCalls(context);
    const feedbackCalls = recordFeedbackCalls(context);
    const judgmentCalls = recordJudgmentCalls(context);
    const page = context.pages()[0] ?? (await context.newPage());

    await runSurfaceTest("4a. X home feed", classifyCalls, () =>
      checkFeed(page, serviceWorker, classifyCalls, "x", "https://x.com/home"), page);
    await runTest("4c. X recycled tweets", () => testXRecycledTweets(page, serviceWorker, classifyCalls));
    await runTest("4i. X reveal: Show and Blur again on a blurred tweet", () => testRevealBlurredPost(page));
    await runTest("4j. X reveal: Show and Hide again on a hidden tweet", () => testRevealHiddenPost(page));
    await runTest("4k. X reveal: a click on a blurred tweet reveals it without opening it", () => testClickOnBlurredPost(page));
    await runTest("4l. X reveal: a revealed tweet stays revealed after X redraws it", () => testRevealSurvivesScrolling(page, "x"));
    await runTest("4d. X feedback: thumbs on a filtered post", () => testJudgeFilteredPost(page, judgmentCalls, "x"));
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
    }, page);
    await runTest("4m. X reveal: Show and Blur again among replies", () => testRevealBlurredPost(page));
    await runTest("4g. X Discover more posts are not replies", () => testXDiscoverMore(page, classifyCalls));
    await runTest("4h. X scroll stability", () => testScrollStability(context, page, serviceWorker, "x", "https://x.com/home"));
    await runTest("4f. scroll performance on X", () =>
      testScrollPerformance(context, serviceWorker, extensionId, classifyCalls, "https://x.com/home"));
  });
}

// YouTube shows a logged-out profile an empty home page until it has watched something, so the
// YouTube group first plays a video, muted, for half a minute. It opens on the watch page, whose
// "up next" column is one of the surfaces under test.
const YOUTUBE_FIRST_VIDEO_URL = "https://www.youtube.com/watch?v=UYhKDweME3A";

// Brave's first navigation in a new profile is sometimes aborted; it is tried once more.
async function gotoFirstPage(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (abortedNavigation) {
    await page.waitForTimeout(2000);
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
}

async function playFirstVideoForHalfAMinute(page) {
  await gotoFirstPage(page, YOUTUBE_FIRST_VIDEO_URL);
  await page.locator("video").waitFor({ state: "attached", timeout: 20000 });
  await page.evaluate(() => {
    const video = document.querySelector("video");
    video.muted = true;
    video.play();
  });
  await page.waitForTimeout(30000);
}

// Added to every page of the YouTube profile: for each video id, when a tile showing it first came
// on screen, and when the extension first blurred or hid it (labelAt). Times are milliseconds since
// the epoch, so they compare with the classify calls' times. A tile that has been on screen is marked
// data-test-seen-on-screen.
function recordTileTimesInPage() {
  const tileSelector = "yt-lockup-view-model, ytd-video-renderer, ytd-grid-video-renderer, ytm-shorts-lockup-view-model";
  const timesByVideoId = {};
  window.brainrotTestTileTimes = timesByVideoId;
  function videoIdOf(tile) {
    const link = tile.querySelector('a[href^="/watch?v="], a[href^="/shorts/"]');
    if (link === null) {
      return null;
    }
    const url = new URL(link.getAttribute("href"), location.origin);
    return url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.split("/")[2];
  }
  const onScreenObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const videoId = videoIdOf(entry.target);
      if (entry.isIntersecting) {
        entry.target.dataset.testSeenOnScreen = "yes";
      }
      if (entry.isIntersecting && videoId !== null && timesByVideoId[videoId] === undefined) {
        timesByVideoId[videoId] = { seenAt: Date.now(), labelAt: null };
      }
    }
  });
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const action = mutation.target.dataset.brainrotIndexAction;
        const times = timesByVideoId[videoIdOf(mutation.target)];
        if ((action === "blur" || action === "hide") && times !== undefined && times.labelAt === null) {
          times.labelAt = Date.now();
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
          continue;
        }
        if (node.matches(tileSelector)) {
          onScreenObserver.observe(node);
        }
        for (const tile of node.querySelectorAll(tileSelector)) {
          onScreenObserver.observe(tile);
        }
      }
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-brainrot-index-action"] });
}

// The time from a tile coming on screen to its answer being shown: for a flagged video the label
// appearing, for an allowed one the answer arriving. An answer shown before the tile came on screen
// counts as 0.
async function reportTileToAnswerTimes(page, classifyCalls, surfaceName) {
  const timesByVideoId = await page.evaluate(() => window.brainrotTestTileTimes);
  const doneAtById = new Map();
  for (const call of classifyCalls) {
    for (const result of call.results) {
      if (result.status === "done" && !doneAtById.has(result.post_id)) {
        doneAtById.set(result.post_id, call.answeredAt);
      }
    }
  }
  const allWaits = [];
  const labelWaits = [];
  for (const [videoId, times] of Object.entries(timesByVideoId)) {
    if (times.labelAt !== null) {
      labelWaits.push(Math.max(0, times.labelAt - times.seenAt));
      allWaits.push(Math.max(0, times.labelAt - times.seenAt));
    } else if (doneAtById.has(videoId)) {
      allWaits.push(Math.max(0, doneAtById.get(videoId) - times.seenAt));
    }
  }
  const median = (waits) => waits.length === 0 ? "none" : [...waits].sort((a, b) => a - b)[Math.floor(waits.length / 2)] + " ms";
  console.log(`    tile on screen to answer shown (${surfaceName}): median ${median(allWaits)} over ${allWaits.length} tiles; `
    + `to label shown: median ${median(labelWaits)} over ${labelWaits.length} flagged tiles`);
}

// One YouTube surface: every tile sent has a complete record, every answered tile shows its answer,
// scrolling (when scrollTimes is not 0) sends more, and nothing answered is sent again after a reload.
// The first video's watch page is already open, and every classify call so far came from it; its
// "up next" column is all sent at once.
async function checkYouTubeSurface(page, serviceWorker, classifyCalls, url, scrollTimes) {
  let callsBefore = classifyCalls.length;
  if (url === YOUTUBE_FIRST_VIDEO_URL) {
    callsBefore = 0;
  } else {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
  await waitUntil(() => classifyCalls.length > callsBefore, 20000);
  await waitForAnswersToSettle(page, classifyCalls);
  const videos = allSentPosts(classifyCalls.slice(callsBefore));
  check(videos.length > 0, `videos were sent (${videos.length})`);
  check(videos.every((video) => video.platform === "youtube" && video.kind === "post" && /^[\w-]{11}$/.test(video.post_id)),
    "every record is a YouTube post with an 11-character video id");
  const incomplete = videos.filter((video) => video.text === "" || !video.url.endsWith(video.post_id));
  check(incomplete.length === 0, "every record has a title and the video's address " + JSON.stringify(incomplete.slice(0, 2)));
  check(videos.every((video) => video.image_urls.length === 1 && video.image_urls[0] === `https://i.ytimg.com/vi/${video.post_id}/hqdefault.jpg`),
    "every record has the video's standard thumbnail");
  console.log(`    records with a channel: ${videos.filter((video) => video.author !== "").length} of ${videos.length}`);
  console.log("    sample record: " + JSON.stringify(videos[0]).slice(0, 400));
  checkBatches(classifyCalls.slice(callsBefore));
  const { actionCounts } = await checkPageMatchesAnswers(page, serviceWorker, "youtube");
  const counts = { blur: actionCounts.blur, hide: actionCounts.hide };

  if (scrollTimes > 0) {
    const sentBeforeScroll = new Set(allSentPosts(classifyCalls).map((post) => post.post_id));
    await scrollDown(page, scrollTimes);
    await waitForAnswersToSettle(page, classifyCalls);
    const newlySent = allSentPosts(classifyCalls).filter((post) => !sentBeforeScroll.has(post.post_id));
    check(newlySent.length > 0, `scrolling sent new videos (${newlySent.length})`);
    const afterScroll = await checkPageMatchesAnswers(page, serviceWorker, "youtube");
    counts.blur = counts.blur + afterScroll.actionCounts.blur;
    counts.hide = counts.hide + afterScroll.actionCounts.hide;
  }
  checkPendingThenDone(classifyCalls.slice(callsBefore));
  checkReasksDoNotOverlap(classifyCalls.slice(callsBefore));
  checkActedOn(counts, "video");
  await reportTileToAnswerTimes(page, classifyCalls.slice(callsBefore), url);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  checkNoResends(classifyCalls);
}

// YouTube's single-page app moves between pages without loading a document and fills tiles it
// already has with other videos. After each move, every answered tile on screen must show its own
// video's answer.
async function testYouTubeNavigation(page, serviceWorker, classifyCalls) {
  await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  await waitForAnswersToSettle(page, classifyCalls);
  await page.locator("ytd-browse yt-lockup-view-model:not([data-brainrot-index-action]) h3 a").first().click();
  await page.waitForURL(/\/watch\?v=/, { timeout: 15000, waitUntil: "commit" });
  await waitForAnswersToSettle(page, classifyCalls);
  console.log("    opened a video from the home feed");
  await checkPageMatchesAnswers(page, serviceWorker, "youtube");
  await page.goBack();
  await page.waitForTimeout(3000);
  await waitForAnswersToSettle(page, classifyCalls);
  console.log("    went back to the home feed");
  await checkPageMatchesAnswers(page, serviceWorker, "youtube");
  for (const query of ["easy dinner recipes", "funny cats"]) {
    await page.fill("input[name=search_query]", query);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/results\?search_query=/, { timeout: 15000, waitUntil: "commit" });
    await page.waitForTimeout(3000);
    await waitForAnswersToSettle(page, classifyCalls);
    console.log(`    searched for "${query}" from the search box`);
    await checkPageMatchesAnswers(page, serviceWorker, "youtube");
  }
  await page.locator("ytd-topbar-logo-renderer a").first().click();
  await page.waitForTimeout(3000);
  await waitForAnswersToSettle(page, classifyCalls);
  console.log("    went home with the logo");
  await checkPageMatchesAnswers(page, serviceWorker, "youtube");
}

// Hovering a tile plays a preview over it; over a blurred tile the preview must not be shown.
async function testNoPreviewOverBlurredTile(page) {
  await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const blurredTile = page.locator('ytd-rich-item-renderer yt-lockup-view-model[data-brainrot-index-action="blur"]:not([data-brainrot-index-revealed])').first();
  if (await blurredTile.count() === 0) {
    reportMissingTreatment("blur");
    return;
  }
  await blurredTile.evaluate((tile) => tile.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(800);
  const box = await blurredTile.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.waitForTimeout(4000);
  const shownPreviews = await page.evaluate(() => [...document.querySelectorAll("ytd-video-preview")]
    .filter((preview) => preview.getBoundingClientRect().width > 0)
    .map((preview) => [...document.querySelectorAll(":hover")].slice(-3).map((element) => element.tagName).join(" > ")));
  await page.mouse.move(5, 5);
  check(shownPreviews.length === 0, "no video preview is shown over a blurred tile " + JSON.stringify(shownPreviews));
}

// Runs in the page: the relative luminance (0 dark to 1 light) of an element's text colour.
function readTextLuminance(element) {
  const [red, green, blue] = getComputedStyle(element).color.match(/\d+/g).map(Number);
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

// YouTube keeps the reader's theme in its PREF cookie, as the "f6" field of "name=value&..." text;
// 400 is dark. Answers the cookie as it was, to put back afterwards.
async function setYouTubeTheme(context, themeValue) {
  const cookies = await context.cookies("https://www.youtube.com");
  const pref = cookies.find((cookie) => cookie.name === "PREF") ?? { name: "PREF", value: "", domain: ".youtube.com", path: "/", secure: true };
  const fields = new URLSearchParams(pref.value);
  fields.set("f6", themeValue);
  await context.addCookies([{ ...pref, value: fields.toString() }]);
  return pref;
}

// The labels read on YouTube's dark theme: a line of its own takes light text, the label over a
// blurred tile keeps its own light-on-dark colours.
async function testYouTubeDarkTheme(context, page, classifyCalls) {
  const prefBefore = await setYouTubeTheme(context, "400");
  try {
    await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
    await waitForAnswersToSettle(page, classifyCalls);
    await scrollDown(page, 2);
    check(await page.evaluate(() => document.documentElement.hasAttribute("dark")), "YouTube shows its dark theme");
    const overLabel = page.locator(".brainrot-index-notice-over-post").first();
    if (await overLabel.count() === 1) {
      check(await overLabel.evaluate(readTextLuminance) > 0.8, "the label over a blurred tile has light text");
    }
    const ownLine = page.locator("ytd-page-manager > :not([hidden]) .brainrot-index-notice:not(.brainrot-index-notice-over-post)").first();
    if (await ownLine.count() === 0) {
      reportMissingTreatment("hide");
      return;
    }
    await ownLine.evaluate((line) => line.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(800);
    check(await ownLine.evaluate(readTextLuminance) > 0.8, "a hidden tile's line has light text on the dark page");
    await saveScreenshotOfFilteredPost(page, "9h-youtube-dark-theme.png");
  } finally {
    if (prefBefore.value === "") {
      await setYouTubeTheme(context, "0");
    } else {
      await context.addCookies([prefBefore]);
    }
  }
}

async function runYouTubeGroup() {
  await withBrave(makeFreshProfileDir("youtube"), {}, async ({ context, serviceWorker, extensionId }) => {
    await context.addInitScript(recordTileTimesInPage);
    const classifyCalls = recordClassifyCalls(context);
    const feedbackCalls = recordFeedbackCalls(context);
    const judgmentCalls = recordJudgmentCalls(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await connectExtension(context, serviceWorker, extensionId, "YouTube profile");
    await playFirstVideoForHalfAMinute(page);

    await runSurfaceTest("9a. YouTube watch page: up next", classifyCalls, () =>
      checkYouTubeSurface(page, serviceWorker, classifyCalls, YOUTUBE_FIRST_VIDEO_URL, 0), page);
    await runSurfaceTest("9b. YouTube home feed", classifyCalls, () =>
      checkYouTubeSurface(page, serviceWorker, classifyCalls, "https://www.youtube.com/", 2), page);
    await runTest("9c. YouTube reveal: Show and Blur again on a blurred tile", () => testRevealBlurredPost(page));
    await runTest("9d. YouTube reveal: Show and Hide again on a hidden tile", () => testRevealHiddenPost(page));
    await runTest("9e. YouTube reveal: a click on a blurred tile reveals it without opening the video", () => testClickOnBlurredPost(page));
    await runTest("9f. YouTube feedback: thumbs on a filtered post", () => testJudgeFilteredPost(page, judgmentCalls, "youtube"));
    await runTest("9g. YouTube feedback: missed post menu item", () => testMissedPostMenuItem(page, serviceWorker, feedbackCalls, "youtube"));
    await runTest("9i. YouTube: no video preview over a blurred tile", () => testNoPreviewOverBlurredTile(page));
    await runSurfaceTest("9j. YouTube search results", classifyCalls, () =>
      checkYouTubeSurface(page, serviceWorker, classifyCalls, "https://www.youtube.com/results?search_query=minecraft", 2), page);
    await runTest("9k. YouTube: answers follow the video through in-app navigation", () =>
      testYouTubeNavigation(page, serviceWorker, classifyCalls));
    await runTest("9h. YouTube dark theme labels", () => testYouTubeDarkTheme(context, page, classifyCalls));
    await runTest("9l. YouTube: the grid does not move when answers arrive", () =>
      testScrollStability(context, page, serviceWorker, "youtube", "https://www.youtube.com/"));
    if (usingMockServer) {
      await runTest("9m. scroll performance on YouTube", () =>
        testScrollPerformance(context, serviceWorker, extensionId, classifyCalls, "https://www.youtube.com/"));
    }
  });
}

// The transcripts group runs on a stand-in for www.youtube.com served by Playwright, so YouTube itself
// is never asked. The server asks for the transcript of every new video; the extension sends none and
// asks YouTube for nothing beyond the page. It records every request made to www.youtube.com.
function fakeYouTubeTilesPage(videoIds) {
  const tiles = videoIds.map((videoId) =>
    `<yt-lockup-view-model style="display:block;height:120px"><h3><a href="/watch?v=${videoId}" title="Video ${videoId}">Video ${videoId}</a></h3></yt-lockup-view-model>`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>YouTube (fake)</title></head><body><ytd-app>${tiles.join("")}</ytd-app></body></html>`;
}

async function serveFakeYouTube(context) {
  const fake = {
    pageVideoIds: [],
    otherRequests: [],   // every address asked of www.youtube.com other than the page itself
  };
  await context.route("https://www.youtube.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") {
      await route.fulfill({ contentType: "text/html", body: fakeYouTubeTilesPage(fake.pageVideoIds) });
      return;
    }
    if (url.pathname !== "/favicon.ico") {
      fake.otherRequests.push(url.pathname + url.search);
    }
    await route.fulfill({ status: 404, body: "" });
  });
  return fake;
}

async function testWantedTranscriptsAreNotFetched(page, fake, classifyCalls) {
  const videoIds = ["newvideo001", "newvideo002", "newvideo003", "newvideo004", "newvideo005", "newvideo006"];
  fake.pageVideoIds = videoIds;
  await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded" });
  check(await waitUntil(() => allSentPosts(classifyCalls).length >= videoIds.length, 10000), "the six tiles are sent");
  check(await waitUntil(() => page.evaluate(() =>
    [...document.querySelectorAll("yt-lockup-view-model")].every((tile) => tile.dataset.brainrotIndexAction !== "pending")), 30000),
  "every tile shows its answer (the mock's slow posts take 15 seconds)");
  const wantedIds = new Set(classifyCalls.flatMap((call) => call.results)
    .filter((result) => result.transcript_wanted).map((result) => result.post_id));
  check(videoIds.every((videoId) => wantedIds.has(videoId)), "the server asked for every video's transcript");
  check(allSentPosts(classifyCalls).every((post) => post.transcript_status === undefined && post.transcript === undefined),
    "no transcript was sent");
  check(fake.otherRequests.length === 0, `nothing beyond the page was asked of YouTube (${fake.otherRequests.join(", ")})`);
}

async function runTranscriptsGroup() {
  await withBrave(makeFreshProfileDir("transcripts"), {}, async ({ context, serviceWorker, extensionId }) => {
    const fake = await serveFakeYouTube(context);
    const classifyCalls = recordClassifyCalls(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await connectExtension(context, serviceWorker, extensionId, "transcripts profile");
    await runTest("10a. transcripts: a video whose transcript the server wants is answered without asking YouTube", () =>
      testWantedTranscriptsAreNotFetched(page, fake, classifyCalls));
  });
}

// The judgments group runs on stand-ins for X, Reddit and YouTube served by Playwright (see
// stand-in-pages.mjs), so no real site is asked. It checks where the thumbs go in each site's row of
// actions, that they show only on hover, and what a thumb and its details send.

async function openStandInPage(page, url, judgeControlCount) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.mouse.move(0, 0);
  check(await waitUntil(() => page.evaluate((count) =>
    document.querySelectorAll('[data-brainrot-index-action="pending"]').length === 0
    && document.querySelectorAll(".brainrot-index-judge").length >= count, judgeControlCount), 15000),
  "every post on the page is answered");
}

async function opacityOf(locator) {
  return Number(await locator.evaluate((element) => getComputedStyle(element).opacity));
}

// Thumbs down on a shown post, then a filter, a severity and details in the box.
async function judgeShownPostAsMissed(page, judgmentCalls, control, platform, postId) {
  const callsBefore = judgmentCalls.length;
  await control.locator('.brainrot-index-judge-button[data-verdict="wrong"]').click();
  await waitUntil(() => judgmentCalls.length > callsBefore, 5000);
  checkJudgmentCall(judgmentCalls[callsBefore], { platform: platform, post_id: postId, verdict: "wrong", shown_action: "allow" });
  const detailsBox = page.locator(".brainrot-index-details");
  await waitUntil(async () => (await detailsBox.locator(".brainrot-index-details-status").textContent()).endsWith("saved"), 3000);
  check(await detailsBox.locator(".brainrot-index-details-status").textContent() === "Should have been filtered · saved",
    "the box says what was saved");
  const filterChips = await detailsBox.locator('.brainrot-index-chip').allTextContents();
  check(filterChips.slice(0, 3).join(",") === "Engagement bait,Ragebait,Brainrot", "the box offers the reader's filters");
  await detailsBox.locator('.brainrot-index-chip[data-value="ragebait"]').click();
  await detailsBox.locator('.brainrot-index-chip[data-value="high"]').click();
  await detailsBox.locator(".brainrot-index-details-input").fill("automated test: outrage farming");
  await detailsBox.locator(".brainrot-index-details-save").click();
  await waitUntil(() => judgmentCalls.length > callsBefore + 1, 5000);
  const detailsCall = judgmentCalls[callsBefore + 1];
  check(detailsCall?.method === "PATCH" && /\/api\/judgments\/\d+\/$/.test(detailsCall.url), "the details are sent to the judgment saved");
  check(JSON.stringify(detailsCall.body) === JSON.stringify({ plugin: "ragebait", severity: "high", details: "automated test: outrage farming" }),
    "with the filter, severity and text: " + JSON.stringify(detailsCall.body));
  check(await waitUntil(async () => (await detailsBox.count()) === 0, 3000), "the box closes once the details are saved");
}

async function testThumbsInXActionRow(page, judgmentCalls) {
  await openStandInPage(page, STAND_IN_URLS.x, 2);
  const shownTweet = SAMPLE_X_TWEETS[0];
  const tweet = page.locator(`article:has(a[href="/${shownTweet.handle}/status/${shownTweet.id}"])`);
  const control = tweet.locator(".brainrot-index-judge");
  check(await control.count() === 1, "the shown tweet has thumbs");
  check(await control.evaluate((element) => element.nextElementSibling.querySelector('[data-testid="caret"]') !== null),
    "they are just before the tweet's More menu");
  check(await opacityOf(control) === 0, "they are hidden while the pointer is elsewhere");
  const promotedMenuBox = await page.locator('article:not(:has(time)) [data-testid="caret"]').boundingBox();
  const menuBox = await tweet.locator('[data-testid="caret"]').boundingBox();
  check(Math.abs(menuBox.x - promotedMenuBox.x) < 1,
    "the More menu did not move (same place as in a tweet without thumbs)");
  const promotedNameRowHeight = (await page.locator("article:not(:has(time)) .head").boundingBox()).height;
  check((await tweet.locator(".head").boundingBox()).height === promotedNameRowHeight, "the name row kept its height");
  await tweet.hover({ position: { x: 300, y: 20 } });
  await page.waitForTimeout(300);
  check(await opacityOf(control) === 1, "hovering the tweet shows them");
  await judgeShownPostAsMissed(page, judgmentCalls, control, "x", shownTweet.id);
  check(await control.locator('[data-verdict="wrong"]').getAttribute("aria-pressed") === "true", "thumbs down stays pressed");
}

async function testThumbsOnHiddenXLine(page, judgmentCalls) {
  await page.evaluate(() => window.redrawFeed());
  const hiddenTweet = SAMPLE_X_TWEETS[1];
  const notice = page.locator(`.brainrot-index-notice:has(+ article [href="/${hiddenTweet.handle}/status/${hiddenTweet.id}"])`);
  check(await waitUntil(async () => (await notice.count()) === 1, 5000), "after a redraw the hidden tweet is one line");
  await page.mouse.move(0, 0);
  check(await notice.locator(".brainrot-index-summary").textContent() === "Hidden · Engagement bait", "the line says what was done and by which filter");
  check((await notice.boundingBox()).height <= 36, "the line is one quiet row");
  check(await opacityOf(notice.locator(".brainrot-index-actions")) === 0, "its buttons are hidden while the pointer is elsewhere");
  await notice.hover();
  await page.waitForTimeout(300);
  check(await opacityOf(notice.locator(".brainrot-index-actions")) === 1, "hovering the line shows Show and the thumbs");
  check(await notice.locator(".brainrot-index-detail").textContent() === "Asks for engagement · 90/100", "and the filter's label and score");
  const callsBefore = judgmentCalls.length;
  await notice.locator('.brainrot-index-judge-button[data-verdict="right"]').click();
  await waitUntil(() => judgmentCalls.length > callsBefore, 5000);
  checkJudgmentCall(judgmentCalls[callsBefore], { platform: "x", post_id: hiddenTweet.id, verdict: "right", shown_action: "hide" });
  const detailsBox = page.locator(".brainrot-index-details");
  check(await detailsBox.locator('.brainrot-index-chip[data-value="ragebait"]').count() === 0, "a filtered post's box asks for no filter");
  await page.mouse.move(0, 0);
  check(await waitUntil(async () => (await detailsBox.count()) === 0, 6000), "the box leaves by itself when the reader does not touch it");
  check(judgmentCalls.length === callsBefore + 1, "and nothing more was sent");
}

async function testThumbsInRedditActionRows(page, judgmentCalls) {
  await openStandInPage(page, STAND_IN_URLS.reddit, 3);
  const shownPost = page.locator(`shreddit-post#${SAMPLE_REDDIT_POSTS[0].id}`);
  const postControl = shownPost.locator(":scope > .brainrot-index-judge");
  check(await postControl.evaluate((element) => element.assignedSlot?.name) === "action-row-whitespace", "a post's thumbs are in its row of actions");
  const comment = page.locator(`shreddit-comment[thingid="${SAMPLE_REDDIT_COMMENTS[0].id}"]`);
  const reply = page.locator(`shreddit-comment[thingid="${SAMPLE_REDDIT_COMMENTS[0].replies[0].id}"]`);
  const commentControl = comment.locator(":scope > [slot='actionRow'] > shreddit-comment-action-row > .brainrot-index-judge");
  const replyControl = reply.locator(":scope > [slot='actionRow'] > shreddit-comment-action-row > .brainrot-index-judge");
  check(await commentControl.evaluate((element) => element.assignedSlot?.name) === "comment-insight", "a comment's thumbs are between Share and its menu");
  await reply.locator('[slot="comment"]').hover();
  await page.waitForTimeout(300);
  check(await opacityOf(replyControl) === 1 && await opacityOf(commentControl) === 0, "hovering a reply shows its thumbs only, not its parent's");
  await comment.locator(':scope > [slot="comment"]').hover();
  await page.waitForTimeout(300);
  check(await opacityOf(commentControl) === 1 && await opacityOf(replyControl) === 0, "hovering the parent shows the parent's");
  await shownPost.hover({ position: { x: 300, y: 20 } });
  await page.waitForTimeout(300);
  await judgeShownPostAsMissed(page, judgmentCalls, postControl, "reddit", SAMPLE_REDDIT_POSTS[0].id);
}

async function testDetailsBoxKeepsKeyPresses(page, judgmentCalls) {
  const comment = page.locator(`shreddit-comment[thingid="${SAMPLE_REDDIT_COMMENTS[0].id}"]`);
  await comment.locator(':scope > [slot="comment"]').hover();
  await comment.locator(':scope > [slot="actionRow"] > shreddit-comment-action-row > .brainrot-index-judge [data-verdict="right"]').click();
  const input = page.locator(".brainrot-index-details .brainrot-index-details-input");
  await input.waitFor({ state: "visible", timeout: 3000 });
  const keyPressesBefore = await page.evaluate(() => window.keyPressesSeenByPage);
  await input.pressSequentially("jkl.");
  check(await page.evaluate(() => window.keyPressesSeenByPage) === keyPressesBefore, "key presses typed in the box never reach the page");
  await page.keyboard.press("Escape");
  check(await page.locator(".brainrot-index-details").count() === 0, "Escape closes the box");
}

async function testThumbsInYouTubeTile(page, judgmentCalls) {
  await openStandInPage(page, STAND_IN_URLS.youtube, 4);
  const video = SAMPLE_YOUTUBE_VIDEOS[0];
  const tile = page.locator(`yt-lockup-view-model:has(h3 a[href="/watch?v=${video.id}"])`);
  const control = tile.locator(".ytLockupMetadataViewModelMenuButton > .brainrot-index-judge");
  check(await control.count() === 1, "the tile's thumbs are in its More actions column");
  const plainTileHeight = (await page.locator(`yt-lockup-view-model:has(h3 a[href="/watch?v=${SAMPLE_YOUTUBE_VIDEOS[2].id}"])`).boundingBox()).height;
  check(Math.abs((await tile.boundingBox()).height - plainTileHeight) < 1, "the tile kept its height");
  check(await opacityOf(control) === 0, "they are hidden while the pointer is elsewhere");
  await tile.hover();
  await page.waitForTimeout(300);
  check(await opacityOf(control) === 1, "hovering the tile shows them");
  const menuBox = await tile.locator('[aria-label="More actions"]').boundingBox();
  check((await control.boundingBox()).y >= menuBox.y + menuBox.height - 1, "under the More actions button");
  const urlBefore = page.url();
  await judgeShownPostAsMissed(page, judgmentCalls, control, "youtube", video.id);
  check(page.url() === urlBefore, "judging did not open the video");
}

async function runJudgmentsGroup() {
  await withBrave(makeFreshProfileDir("judgments"), {}, async ({ context, serviceWorker, extensionId }) => {
    await serveStandInPages(context, samplePages());
    const judgmentCalls = recordJudgmentCalls(context);
    const page = context.pages()[0] ?? (await context.newPage());
    await connectExtension(context, serviceWorker, extensionId, "stand-in sites profile");
    await runTest("11a. judgments: thumbs by an X tweet's More menu", () => testThumbsInXActionRow(page, judgmentCalls));
    await runTest("11b. judgments: thumbs on a hidden tweet's line", () => testThumbsOnHiddenXLine(page, judgmentCalls));
    await runTest("11c. judgments: thumbs in Reddit's post and comment rows", () => testThumbsInRedditActionRows(page, judgmentCalls));
    await runTest("11d. judgments: the details box keeps key presses", () => testDetailsBoxKeepsKeyPresses(page, judgmentCalls));
    await runTest("11e. judgments: thumbs in a YouTube tile", () => testThumbsInYouTubeTile(page, judgmentCalls));
  });
}

function pgrepFinds(pattern) {
  try {
    return execFileSync("pgrep", ["-f", pattern], { encoding: "utf8" }).trim() !== "";
  } catch (noMatch) {
    return false; // pgrep exits with status 1 when nothing matches
  }
}

const requestedGroups = process.argv.slice(2);
const groupsToRun = requestedGroups.length > 0 ? requestedGroups : ["connect", "reddit", "x", "youtube", "transcripts", "judgments"];
const mockServer = usingMockServer ? await startMockServer(MOCK_PORT) : null;
console.log("server: " + serverAddress + (usingMockServer ? " (mock)" : ""));
try {
  if (groupsToRun.includes("connect")) {
    await runTest("0. connect from a website tab opened before the extension", testConnectFromTabOpenedFirst);
  }
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
  if (groupsToRun.includes("youtube")) {
    await runYouTubeGroup();
  }
  if (groupsToRun.includes("transcripts")) {
    await runTranscriptsGroup();
  }
  if (groupsToRun.includes("judgments")) {
    await runJudgmentsGroup();
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
