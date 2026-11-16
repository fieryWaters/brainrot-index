// The extension API object: `browser` in Safari and Firefox, `chrome` in Chromium browsers.
const extensionApi = globalThis.browser ?? globalThis.chrome;
