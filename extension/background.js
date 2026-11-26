// Background service worker: the only part of the extension that talks to the BrainRot Index server.
// The browser may stop this worker at any time, so everything it remembers lives in storage:
//   storage.local:   serverAddress, token, extensionEnabled,
//                    dataSharingConsent ({ version, agreedAt }) once the reader agreed on the consent screen,
//                    consentRecordedOnServer once the server has a record of that agreement for this token
//   storage.session: one "answer:<platform>:<post_id>" entry per post the server has finished with
importScripts("extension-api.js");

// The server a new install talks to. Installs that already have a serverAddress keep it (the options
// page changes it); the private address is https://brainrot.jacob-waters.com.
const DEFAULT_SERVER_ADDRESS = "https://brainrotindex.com";
// The date the consent screen's wording last changed. A reader who agreed to an older wording is
// asked again, and nothing is sent until they agree to this one.
const DATA_SHARING_DISCLOSURE_VERSION = "2026-11-23";

extensionApi.runtime.onInstalled.addListener(async () => {
  const stored = await extensionApi.storage.local.get(["serverAddress", "extensionEnabled"]);
  if (stored.serverAddress === undefined) {
    await extensionApi.storage.local.set({ serverAddress: DEFAULT_SERVER_ADDRESS });
  }
  if (stored.extensionEnabled === undefined) {
    await extensionApi.storage.local.set({ extensionEnabled: true });
  }
  if (!(await hasAgreedToDataSharing())) {
    await openConsentPage();
  }
});

async function hasAgreedToDataSharing() {
  const { dataSharingConsent } = await extensionApi.storage.local.get("dataSharingConsent");
  if (dataSharingConsent === undefined) {
    return false;
  }
  return dataSharingConsent.version === DATA_SHARING_DISCLOSURE_VERSION;
}

async function openConsentPage() {
  await extensionApi.tabs.create({ url: extensionApi.runtime.getURL("consent/consent.html") });
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
  if (message.type === "agree-to-data-sharing") {
    agreeToDataSharing().then(sendResponse);
    return true;
  }
  if (message.type === "token-received") {
    startConnection().then(sendResponse);
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
  if (message.type === "remove-judgment") {
    removeJudgment(message.judgmentId).then(sendResponse);
    return true;
  }
  if (message.type === "add-judgment-details") {
    addJudgmentDetails(message.judgmentId, message.details).then(sendResponse);
    return true;
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

// The reader pressed "Agree and continue" on the consent screen. Answers { connected }: whether the
// extension already holds an account token.
async function agreeToDataSharing() {
  await extensionApi.storage.local.set({
    dataSharingConsent: { version: DATA_SHARING_DISCLOSURE_VERSION, agreedAt: new Date().toISOString() },
    consentRecordedOnServer: false,
  });
  const { token } = await extensionApi.storage.local.get("token");
  if (token === undefined) {
    return { connected: false };
  }
  await recordConsentOnServer();
  return { connected: true };
}

// The website handed over a new token. Answers { consentNeeded }: true
// when the reader has not agreed yet, in which case the consent screen is opened and nothing is sent.
async function startConnection() {
  await extensionApi.storage.local.set({ consentRecordedOnServer: false });
  if (!(await hasAgreedToDataSharing())) {
    await openConsentPage();
    return { consentNeeded: true };
  }
  await recordConsentOnServer();
  return { consentNeeded: false };
}

// Gives the server a record that this token's reader agreed, and when. Tried again on every status
// check until the server has it, so a failed attempt is not lost.
async function recordConsentOnServer() {
  const { dataSharingConsent } = await extensionApi.storage.local.get("dataSharingConsent");
  let response;
  try {
    response = await callServer("POST", "/api/extension/consent/", {
      disclosure_version: dataSharingConsent.version,
      agreed_at: dataSharingConsent.agreedAt,
    });
  } catch (networkError) {
    return;
  }
  if (response.ok) {
    await extensionApi.storage.local.set({ consentRecordedOnServer: true });
  }
}

// Answers { state, config }. state is "consent-needed", "connected", "not-connected",
// "no-subscription", "email-not-verified", "server-error" or "server-unreachable"; config is present
// only when connected. Before the reader agrees on the consent screen nothing is sent to the server.
async function getStatus() {
  if (!(await hasAgreedToDataSharing())) {
    return { state: "consent-needed" };
  }
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
  const { consentRecordedOnServer } = await extensionApi.storage.local.get("consentRecordedOnServer");
  if (!consentRecordedOnServer) {
    await recordConsentOnServer();
  }
  return { state: "connected", config: await response.json() };
}

// Answers { state, results, showDailyLimitNotice } where results holds one server result per post,
// taken from the session cache when the server has already finished with that post in this browser
// session. A post past the account's daily limit comes back allowed with notice "daily_limit_reached"
// and is not cached, so it is checked once the limit resets. showDailyLimitNotice is true the first
// time that happens in a browser session.
async function classifyPosts(posts) {
  if (!(await hasAgreedToDataSharing())) {
    return { state: "consent-needed" };
  }
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
  if (!(await hasAgreedToDataSharing())) {
    return { sent: false, reason: "Nothing is sent until you agree to the notice. Open it from the BrainRot Index toolbar button." };
  }
  const { token } = await extensionApi.storage.local.get("token");
  if (token === undefined) {
    return { sent: false, reason: "Not connected. Open the BrainRot Index toolbar button and press Connect account." };
  }
  let response;
  try {
    response = await callServer(method, path, body);
  } catch (networkError) {
    return { sent: false, reason: "Cannot reach the server." };
  }
  if (response.status === 204) {
    return { sent: true, body: null };
  }
  if (response.ok) {
    return { sent: true, body: await response.json() };
  }
  if (response.status === 401) {
    return { sent: false, reason: "The connection was refused. Open the BrainRot Index toolbar button and press Connect account." };
  }
  return { sent: false, reason: "The server answered with error " + response.status + "." };
}

// feedback holds text and, when the popup was opened over a supported site, page_url.
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

// details holds any of should_be, plugin (a plugin slug, or null for Other), severity and details.
async function addJudgmentDetails(judgmentId, details) {
  return sendReport("PATCH", "/api/judgments/" + judgmentId + "/", details);
}

// Takes back a thumbs up or down: the reader clicked the same thumb again.
async function removeJudgment(judgmentId) {
  return sendReport("DELETE", "/api/judgments/" + judgmentId + "/");
}
