// Connects the extension to the account of the reader signed in to the BrainRot Index website.
// On every page of the site it announces itself with the extension's account state; when that state
// is "not-connected" (no token, or the server refused the one it had), the website, if someone is
// signed in, creates a token for that account and hands it over here.
// The manifest loads this script on every address the server may use; it only listens on the one
// the options page is set to.

extensionApi.storage.local.get("serverAddress").then((stored) => {
  if (window.location.origin !== new URL(stored.serverAddress).origin) {
    return;
  }

  // accountState is the popup's state: "consent-needed", "connected", "not-connected", and so on.
  async function announcePresence() {
    const status = await extensionApi.runtime.sendMessage({ type: "get-status" });
    window.postMessage({ type: "brainrot-index-extension-present", accountState: status.state }, window.location.origin);
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== window.location.origin) {
      return;
    }
    if (event.data?.type === "brainrot-index-extension-ping") {
      announcePresence();
      return;
    }
    if (event.data?.type !== "brainrot-index-extension-token") {
      return;
    }
    await extensionApi.storage.local.set({ token: event.data.token });
    // Before the reader agrees to the consent screen, the extension opens it and sends nothing.
    const reply = await extensionApi.runtime.sendMessage({ type: "token-received" });
    if (reply.consentNeeded) {
      window.postMessage({ type: "brainrot-index-extension-consent-needed" }, window.location.origin);
    } else {
      window.postMessage({ type: "brainrot-index-extension-connected" }, window.location.origin);
    }
  });

  // A page that asked before this listener was ready hears it now.
  announcePresence();
});
