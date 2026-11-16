// Receives the account token from the "Connect extension" button on the Brainrot Index website.
// The manifest loads this script on every address the server may use; it only listens on the one
// the options page is set to.

extensionApi.storage.local.get("serverAddress").then((stored) => {
  if (window.location.origin !== new URL(stored.serverAddress).origin) {
    return;
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window
        || event.origin !== window.location.origin
        || event.data?.type !== "brainrot-index-extension-token") {
      return;
    }
    await extensionApi.storage.local.set({ token: event.data.token });
    window.postMessage({ type: "brainrot-index-extension-connected" }, window.location.origin);
  });
});
