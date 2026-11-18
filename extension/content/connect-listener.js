// Receives the account token from the "Connect extension" button on the Brainrot Index website, and
// tells the website the extension is installed, so its setup checklist can say so.
// The manifest loads this script on every address the server may use; it only listens on the one
// the options page is set to.

extensionApi.storage.local.get("serverAddress").then((stored) => {
  if (window.location.origin !== new URL(stored.serverAddress).origin) {
    return;
  }

  function announcePresence() {
    window.postMessage({ type: "brainrot-index-extension-present" }, window.location.origin);
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
