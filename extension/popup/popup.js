// Toolbar popup: account state, the on/off switch, and counts for this browser session.

const ACCOUNT_STATUS_TEXT = {
  "consent-needed": "Nothing is sent until you agree to share the posts you see with BrainRot Index.",
  "connected": "Connected to your account",
  "not-connected": "Not connected. Open BrainRot Index and press Connect extension.",
  "no-subscription": "Your free trial has ended. Subscribe to continue.",
  "email-not-verified": "Verify your email first: open the link BrainRot Index emailed you, then reload the page.",
  "server-error": "The server answered with an error.",
  "server-unreachable": "Cannot reach the server.",
};

async function showAccountStatus() {
  const status = await extensionApi.runtime.sendMessage({ type: "get-status" });
  document.getElementById("account-status").textContent = ACCOUNT_STATUS_TEXT[status.state];
  if (status.state === "no-subscription") {
    const { serverAddress } = await extensionApi.storage.local.get("serverAddress");
    document.getElementById("subscribe-link").href = serverAddress + "/dashboard";
    document.getElementById("subscribe-row").hidden = false;
  }
  if (status.state === "consent-needed") {
    document.getElementById("consent-row").hidden = false;
  }
}

function setUpConsentButton() {
  document.getElementById("consent-button").addEventListener("click", () => {
    extensionApi.tabs.create({ url: extensionApi.runtime.getURL("consent/consent.html") });
  });
}

// Counts the answers the background worker has cached this session: one per post checked.
async function showSessionCounts() {
  const sessionEntries = await extensionApi.storage.session.get(null);
  let checkedCount = 0;
  let actedOnCount = 0;
  for (const [key, answer] of Object.entries(sessionEntries)) {
    if (!key.startsWith("answer:")) {
      continue;
    }
    checkedCount = checkedCount + 1;
    if (answer.action !== "allow") {
      actedOnCount = actedOnCount + 1;
    }
  }
  document.getElementById("checked-count").textContent = checkedCount;
  document.getElementById("acted-on-count").textContent = actedOnCount;
}

async function setUpSwitchAndLink() {
  const stored = await extensionApi.storage.local.get(["extensionEnabled", "serverAddress"]);
  const enabledSwitch = document.getElementById("enabled-switch");
  enabledSwitch.checked = stored.extensionEnabled;
  enabledSwitch.addEventListener("change", () => {
    extensionApi.storage.local.set({ extensionEnabled: enabledSwitch.checked });
  });
  document.getElementById("site-link").href = stored.serverAddress;
}

// Free-text feedback, sent with the address of the tab the popup was opened over.
function setUpFeedbackForm() {
  const feedbackText = document.getElementById("feedback-text");
  const feedbackStatus = document.getElementById("feedback-status");
  document.getElementById("feedback-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const [activeTab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
    const reply = await extensionApi.runtime.sendMessage({
      type: "send-feedback",
      feedback: { text: feedbackText.value, page_url: activeTab.url },
    });
    if (reply.sent) {
      feedbackText.value = "";
      feedbackStatus.textContent = "Sent, thank you";
    } else {
      feedbackStatus.textContent = "Not sent. " + reply.reason;
    }
  });
}

async function showExtensionCommit() {
  const commit = await extensionApi.runtime.sendMessage({ type: "get-extension-commit" });
  document.getElementById("extension-commit").textContent = commit;
}

setUpSwitchAndLink();
setUpFeedbackForm();
setUpConsentButton();
showExtensionCommit();
showAccountStatus();
showSessionCounts();
