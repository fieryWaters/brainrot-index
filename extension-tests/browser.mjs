// Launches Brave with the extension loaded unpacked, with no window on screen. Reddit and X block
// headless browsers, so a launch that visits the live sites asks for a window with showWindow.
// Branded Google Chrome ignores --load-extension, so it cannot be used here.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

export const TESTS_DIR = path.dirname(new URL(import.meta.url).pathname);
export const EXTENSION_DIR = path.resolve(TESTS_DIR, "..", "extension");
// BRAINROT_BROWSER names another Chromium build, such as Playwright's own on a Linux machine.
const BRAVE_BINARY = process.env.BRAINROT_BROWSER ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
// No test run takes this long; a browser still open after it was left behind by a stuck run.
const MAX_BROWSER_LIFETIME_MS = 60 * 60 * 1000;
// Chromium's new headless mode is the full browser, extensions included, with no window on screen.
// Playwright's own headless option is left off, since it also changes how the page reports hovering.
// BRAINROT_SHOW_BROWSER=1 shows the window, for watching a run.
export const HIDE_WINDOW_ARGS = process.env.BRAINROT_SHOW_BROWSER ? [] : ["--headless=new"];

// Closes the browser once it has been open for MAX_BROWSER_LIFETIME_MS. The timer does not keep the
// test process alive. Callers still close the browser in a finally block when they are done.
function closeWhenLeftOpen(context) {
  const timer = setTimeout(() => {
    console.log("closing a Brave window left open for an hour");
    context.close();
  }, MAX_BROWSER_LIFETIME_MS);
  timer.unref();
  context.on("close", () => clearTimeout(timer));
}

// A new empty profile inside extension-tests/.profiles/, so the owner's real profiles are never used.
export function makeFreshProfileDir(name) {
  const profilesDir = path.join(TESTS_DIR, ".profiles");
  fs.mkdirSync(profilesDir, { recursive: true });
  return fs.mkdtempSync(path.join(profilesDir, name + "-"));
}

// A profile the owner signed in to by hand keeps its cookies encrypted with the macOS keychain, so
// for that profile Playwright's stand-in keychain must be left out or the sign-in is unreadable.
// A profile used before keeps running the background worker it had then, even after the files
// change, so for that profile the extension is loaded again from disk, as the reload button does.
export async function launchBrave(profileDir, { signedInProfile = false, showWindow = false } = {}) {
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
      "--enable-unsafe-extension-debugging",
      ...(showWindow ? [] : HIDE_WINDOW_ARGS),
    ],
    viewport: { width: 1280, height: 900 },
  });
  closeWhenLeftOpen(context);
  // A browser whose extension never started is closed here, since the caller never receives it.
  try {
    let serviceWorker = context.serviceWorkers()[0];
    if (serviceWorker === undefined) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    }
    if (signedInProfile) {
      const reloadedWorker = context.waitForEvent("serviceworker", { timeout: 15000 });
      await loadExtensionLater(context);
      serviceWorker = await reloadedWorker;
    }
    const extensionId = new URL(serviceWorker.url()).host;
    return { context, serviceWorker, extensionId };
  } catch (error) {
    await context.close();
    throw error;
  }
}

// Launches Brave with the extension, runs useBrowser({ context, serviceWorker, extensionId }), and
// closes the browser afterwards, also when useBrowser throws.
export async function withBrave(profileDir, launchOptions, useBrowser) {
  const launched = await launchBrave(profileDir, launchOptions);
  try {
    return await useBrowser(launched);
  } finally {
    await launched.context.close();
  }
}


// Brave with no extension yet. loadExtensionLater then installs it the way Load unpacked does,
// so a test can open tabs first, as a person does before installing.
export async function launchBraveWithoutExtension(profileDir) {
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath: BRAVE_BINARY,
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging", ...HIDE_WINDOW_ARGS],
    viewport: { width: 1280, height: 900 },
  });
  closeWhenLeftOpen(context);
  return context;
}

export async function loadExtensionLater(context) {
  const browserSession = await context.browser().newBrowserCDPSession();
  const { id } = await browserSession.send("Extensions.loadUnpacked", { path: EXTENSION_DIR });
  return id;
}
