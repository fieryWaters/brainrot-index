// Toolbar popup: account state, the on/off switch, and counts for this browser session.

const ACCOUNT_STATUS_TEXT = {
  "connected": "Connected to your account",
  "not-connected": "Not connected. Open Brainrot Index and press Connect extension.",
  "no-subscription": "No active subscription or trial, so nothing is filtered.",
  "server-error": "The server answered with an error.",
  "server-unreachable": "Cannot reach the server.",
};

async function showAccountStatus() {
  const status = await extensionApi.runtime.sendMessage({ type: "get-status" });
  document.getElementById("account-status").textContent = ACCOUNT_STATUS_TEXT[status.state];
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
      feedbackStatus.textContent = "Could not send";
    }
  });
}

async function showExtensionCommit() {
  const commit = await extensionApi.runtime.sendMessage({ type: "get-extension-commit" });
  document.getElementById("extension-commit").textContent = commit;
}

setUpSwitchAndLink();
setUpFeedbackForm();
showExtensionCommit();
showAccountStatus();
showSessionCounts();
