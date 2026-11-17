// Background service worker: the only part of the extension that talks to the BrainRot Index server.
// The browser may stop this worker at any time, so everything it remembers lives in storage:
//   storage.local:   serverAddress, token, extensionEnabled
//   storage.session: one "answer:<platform>:<post_id>" entry per post the server has finished with
importScripts("extension-api.js");

// The server a new install talks to. Installs that already have a serverAddress keep it (the options
// page changes it); the private address is https://brainrot.jacob-waters.com.
const DEFAULT_SERVER_ADDRESS = "https://brainrotindex.com";
const MISSED_POST_MENU_ITEM_ID = "should-have-been-filtered";

extensionApi.runtime.onInstalled.addListener(async () => {
  extensionApi.contextMenus.create({
    id: MISSED_POST_MENU_ITEM_ID,
    title: "BrainRot Index: report this post",
    contexts: ["all"],
    documentUrlPatterns: ["https://www.reddit.com/*", "https://x.com/*", "https://www.youtube.com/*"],
  });

  const stored = await extensionApi.storage.local.get(["serverAddress", "extensionEnabled"]);
  if (stored.serverAddress === undefined) {
    await extensionApi.storage.local.set({ serverAddress: DEFAULT_SERVER_ADDRESS });
  }
  if (stored.extensionEnabled === undefined) {
    await extensionApi.storage.local.set({ extensionEnabled: true });
  }
  await addConnectListenerToOpenSiteTabs();
});

// The browser gives content scripts only to pages loaded after the extension was installed or
// reloaded, so a website tab that was already open could not hand over its token. This adds the
// connect listener to such tabs.
async function addConnectListenerToOpenSiteTabs() {
  const { serverAddress } = await extensionApi.storage.local.get("serverAddress");
  // Match patterns cannot name a port; connect-listener.js checks the full origin itself.
  const siteUrl = new URL(serverAddress);
  const siteTabs = await extensionApi.tabs.query({ url: siteUrl.protocol + "//" + siteUrl.hostname + "/*" });
  for (const siteTab of siteTabs) {
    await extensionApi.scripting.executeScript({
      target: { tabId: siteTab.id },
      files: ["extension-api.js", "content/connect-listener.js"],
    });
  }
}

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "get-status") {
    getStatus().then(sendResponse);
    return true;
  }
  if (message.type === "classify") {
    classifyPosts(message.posts).then(sendResponse);
    return true;
  }
  if (message.type === "get-extension-commit") {
    extensionCommit().then(sendResponse);
    return true;
  }
  if (message.type === "send-feedback") {
    sendFeedback(message.feedback).then(sendResponse);
    return true;
  }
  if (message.type === "send-judgment") {
    sendJudgment(message.judgment).then(sendResponse);
    return true;
  }
  if (message.type === "add-judgment-details") {
    addJudgmentDetails(message.judgmentId, message.details).then(sendResponse);
    return true;
  }
});

extensionApi.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MISSED_POST_MENU_ITEM_ID) {
    reportMissedPost(tab.id, info.frameId, info.pageUrl);
  }
});

function answerKey(platform, postId) {
  return "answer:" + platform + ":" + postId;
}

async function callServer(method, path, body) {
  const { serverAddress, token } = await extensionApi.storage.local.get(["serverAddress", "token"]);
  return fetch(serverAddress + path, {
    method: method,
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Turns a server response that is not a success into the account state the popup and content scripts show.
async function stateFromFailedResponse(response) {
  if (response.status === 401) {
    return "not-connected";
  }
  if (response.status === 402) {
    return "no-subscription";
  }
  if (response.status === 403) {
    const body = await response.json().catch(() => ({}));
    if (body.code === "email_not_verified") {
      return "email-not-verified";
    }
  }
  return "server-error";
}

// Answers { state, config }. state is "connected", "not-connected", "no-subscription",
// "email-not-verified", "server-error" or "server-unreachable"; config is present only when connected.
async function getStatus() {
  const { token } = await extensionApi.storage.local.get("token");
  if (token === undefined) {
    return { state: "not-connected" };
  }

  let response;
  try {
    response = await callServer("GET", "/api/extension/config/");
  } catch (networkError) {
    return { state: "server-unreachable" };
  }
  if (!response.ok) {
    return { state: await stateFromFailedResponse(response) };
  }
  return { state: "connected", config: await response.json() };
}

// Answers { state, results, showDailyLimitNotice } where results holds one server result per post,
// taken from the session cache when the server has already finished with that post in this browser
// session. A post past the account's daily limit comes back allowed with notice "daily_limit_reached"
// and is not cached, so it is checked once the limit resets. showDailyLimitNotice is true the first
// time that happens in a browser session.
async function classifyPosts(posts) {
  const cachedAnswers = await extensionApi.storage.session.get(
    posts.map((post) => answerKey(post.platform, post.post_id))
  );
  const results = [];
  const postsToSend = [];
  for (const post of posts) {
    const cachedAnswer = cachedAnswers[answerKey(post.platform, post.post_id)];
    if (cachedAnswer === undefined) {
      postsToSend.push(post);
    } else {
      results.push(cachedAnswer);
    }
  }
  if (postsToSend.length === 0) {
    return { state: "connected", results: results };
  }

  let response;
  try {
    response = await callServer("POST", "/api/classify/", { posts: postsToSend });
  } catch (networkError) {
    return { state: "server-unreachable" };
  }
  if (!response.ok) {
    return { state: await stateFromFailedResponse(response) };
  }

  const serverResults = (await response.json()).results;
  const finishedAnswers = {};
  let dailyLimitReached = false;
  for (const result of serverResults) {
    if (result.notice === "daily_limit_reached") {
      dailyLimitReached = true;
    } else if (result.status === "done") {
      finishedAnswers[answerKey(result.platform, result.post_id)] = result;
    }
  }
  await extensionApi.storage.session.set(finishedAnswers);

  let showDailyLimitNotice = false;
  if (dailyLimitReached) {
    const { dailyLimitNoticeShown } = await extensionApi.storage.session.get("dailyLimitNoticeShown");
    if (!dailyLimitNoticeShown) {
      showDailyLimitNotice = true;
      await extensionApi.storage.session.set({ dailyLimitNoticeShown: true });
    }
  }
  return { state: "connected", results: results.concat(serverResults), showDailyLimitNotice: showDailyLimitNotice };
}

// The git commit this copy of the extension was loaded from, written to build-info.json by
// extension-tests/stamp-build-info.mjs. "unstamped" when that file was never written.
async function extensionCommit() {
  try {
    const response = await fetch(extensionApi.runtime.getURL("build-info.json"));
    const buildInfo = await response.json();
    if (buildInfo.dirty) {
      return buildInfo.commit + "-dirty";
    }
    return buildInfo.commit;
  } catch (missingFile) {
    return "unstamped";
  }
}

// Sends a report to the server. Answers { sent: true, body } with the server's reply when it was
// recorded, otherwise { sent: false, reason } where reason is a sentence for the reader.
async function sendReport(method, path, body) {
  const { token } = await extensionApi.storage.local.get("token");
  if (token === undefined) {
    return { sent: false, reason: "Not connected. Open BrainRot Index and press Connect extension." };
  }
  let response;
  try {
    response = await callServer(method, path, body);
  } catch (networkError) {
    return { sent: false, reason: "Cannot reach the server." };
  }
  if (response.ok) {
    return { sent: true, body: await response.json() };
  }
  if (response.status === 401) {
    return { sent: false, reason: "The connection was refused. Open BrainRot Index and press Connect extension again." };
  }
  return { sent: false, reason: "The server answered with error " + response.status + "." };
}

// feedback holds any of text, page_url, platform, post_id, shown_action and expected_action.
async function sendFeedback(feedback) {
  const body = { ...feedback, source: "extension", extension_commit: await extensionCommit() };
  return sendReport("POST", "/api/feedback/", body);
}

// judgment is { platform, post_id, verdict, shown_action }: a thumbs up ("right") or down ("wrong")
// on a post the server answered for. The reply's body holds the judgment's id.
async function sendJudgment(judgment) {
  const body = { ...judgment, extension_commit: await extensionCommit() };
  return sendReport("POST", "/api/judgments/", body);
}

// details holds any of severity, details and plugin (a plugin slug).
async function addJudgmentDetails(judgmentId, details) {
  return sendReport("PATCH", "/api/judgments/" + judgmentId + "/", details);
}

// Opens the report form over the post the reader last right-clicked in that tab. When the right-click
// was not inside a post, the page itself is reported as one that should have been filtered.
async function reportMissedPost(tabId, frameId, pageUrl) {
  const openedForm = await extensionApi.tabs.sendMessage(tabId, { type: "open-report-form" }, { frameId: frameId });
  if (openedForm) {
    return;
  }
  return sendFeedback({ page_url: pageUrl, expected_action: "hide" });
}
