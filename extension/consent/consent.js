// Consent screen: says what the extension sends before it sends anything. The background worker
// sends nothing to the server until the reader presses "Agree and continue" here.

const AGREED_AND_CONNECTED_TEXT = "Thank you. Filtering starts the next time you open or reload a supported site.";
const AGREED_NOT_CONNECTED_TEXT = "Thank you. Next, open your BrainRot Index dashboard and press Connect extension.";
const NOT_NOW_TEXT = "Nothing was sent. You can agree later from the BrainRot Index button in your browser's toolbar.";

function showOutcome(text) {
  document.getElementById("disclosure").hidden = true;
  const outcome = document.getElementById("outcome");
  outcome.textContent = text;
  outcome.hidden = false;
}

extensionApi.storage.local.get("serverAddress").then((stored) => {
  document.getElementById("privacy-link").href = stored.serverAddress + "/privacy";
});

document.getElementById("agree-button").addEventListener("click", async () => {
  const reply = await extensionApi.runtime.sendMessage({ type: "agree-to-data-sharing" });
  if (reply.connected) {
    showOutcome(AGREED_AND_CONNECTED_TEXT);
  } else {
    showOutcome(AGREED_NOT_CONNECTED_TEXT);
  }
});

document.getElementById("not-now-button").addEventListener("click", () => {
  showOutcome(NOT_NOW_TEXT);
});
