// Launches headed Brave with the extension loaded unpacked. Headed because Reddit and X block
// headless browsers. Branded Google Chrome ignores --load-extension, so it cannot be used here.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

export const TESTS_DIR = path.dirname(new URL(import.meta.url).pathname);
export const EXTENSION_DIR = path.resolve(TESTS_DIR, "..", "extension");
const BRAVE_BINARY = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

// A new empty profile inside extension-tests/.profiles/, so the owner's real profiles are never used.
export function makeFreshProfileDir(name) {
  const profilesDir = path.join(TESTS_DIR, ".profiles");
  fs.mkdirSync(profilesDir, { recursive: true });
  return fs.mkdtempSync(path.join(profilesDir, name + "-"));
}

// A profile the owner signed in to by hand keeps its cookies encrypted with the macOS keychain, so
// for that profile Playwright's stand-in keychain must be left out or the sign-in is unreadable.
export async function launchBrave(profileDir, { signedInProfile = false } = {}) {
  const ignoredDefaultArgs = ["--disable-extensions"];
  if (signedInProfile) {
    ignoredDefaultArgs.push("--use-mock-keychain");
  }
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: BRAVE_BINARY,
    headless: false,
    ignoreDefaultArgs: ignoredDefaultArgs,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
    ],
    viewport: { width: 1280, height: 900 },
  });
  let serviceWorker = context.serviceWorkers()[0];
  if (serviceWorker === undefined) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;
  return { context, serviceWorker, extensionId };
}
