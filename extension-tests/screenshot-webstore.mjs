// The Chrome Web Store screenshots: five 1280 x 800 pictures, each a caption on the brand's navy beside
// a picture of the real extension at work. The feeds are the stand-in pages (stand-in-pages.mjs) with
// made-up posts, answered by the mock server, so no real site is asked. The dashboard is the site's
// own build (frontend/brainrot-index-frontend/dist, made by `npx vite build` there) with its API
// answered by the fixed data below.
//
// Usage: node screenshot-webstore.mjs [output folder]   (default: ../docs/webstore)
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_DIR, TESTS_DIR, makeFreshProfileDir } from "./browser.mjs";
import { startMockServer, MOCK_TOKEN, MOCK_CONFIG } from "./mock-server.mjs";
import { SAMPLE_REDDIT_POSTS, SAMPLE_X_TWEETS, SAMPLE_YOUTUBE_VIDEOS, STAND_IN_URLS, samplePages, serveStandInPages } from "./stand-in-pages.mjs";

const BRAVE_BINARY = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const REPOSITORY_DIR = path.resolve(TESTS_DIR, "..");
const SITE_BUILD_DIR = path.join(REPOSITORY_DIR, "frontend", "brainrot-index-frontend", "dist");
const MARK_FILE = path.join(REPOSITORY_DIR, "brand", "mark-transparent.png");
const outputDir = path.resolve(process.argv[2] ?? path.join(REPOSITORY_DIR, "docs", "webstore"));
const MOCK_PORT = 8787;
const SITE_ORIGIN = "https://brainrotindex.com";

const SLIDE_WIDTH = 1280;
const SLIDE_HEIGHT = 800;
// Pictures of the extension are taken at twice the size they are shown, so they stay sharp.
const PICTURE_SCALE = 2;

// The brand palette, as in make-icons.mjs and the site's src/index.css.
const NAVY_950 = "#0b1830";
const NAVY_800 = "#183453";
const GLOW_200 = "#d2ffff";
const GLOW_300 = "#9eeef5";
const GLOW_400 = "#4cbbe1";

// -- The dashboard's API, answered with one signed-in adult account on its free trial --

const DASHBOARD_PLUGINS = [
  { slug: "engagement-bait", name: "Engagement bait", description: "Posts made to farm replies, likes and shares.", enabled: true, threshold: 70, flagged_action: "hide" },
  { slug: "ragebait", name: "Ragebait", description: "Posts built to make you angry.", enabled: true, threshold: 60, flagged_action: "blur" },
  { slug: "brainrot", name: "Brainrot", description: "Attention sinks with nothing inside.", enabled: true, threshold: 50, flagged_action: "hide" },
  { slug: "ai-slop", name: "AI slop", description: "Mass-produced generated content and reply-guy promotion.", enabled: false, threshold: 65, flagged_action: "hide" },
];

const DASHBOARD_ANSWERS = {
  "/api/auth/me/": { email: "you@example.com", email_verified: true, auth_provider: "password" },
  "/api/onboarding/": { email_verified: true, extension_connected: true, feed_opened: true },
  "/api/billing/": { status: "trialing", has_access: true, comp: false, trial_days_left: 5, current_period_end: null, cancel_at_period_end: false, can_manage: false },
  "/api/family/": { role: "superadmin", family: null },
  "/api/settings/": { enabled: true, mode: "adult", allow_reveal: true },
  "/api/plugins/": { plugins: DASHBOARD_PLUGINS, enabled_limit: 8, can_change: true },
  "/api/store/plugins/": { plugins: [] },
};

const SITE_CONTENT_TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".json": "application/json", ".txt": "text/plain" };

// Serves the site's build at SITE_ORIGIN, every page address answered with index.html as nginx does.
async function serveSiteBuild(context) {
  await context.route(SITE_ORIGIN + "/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith("/api/")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DASHBOARD_ANSWERS[pathname] ?? {}) });
      return;
    }
    let file = path.join(SITE_BUILD_DIR, pathname);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(SITE_BUILD_DIR, "index.html");
    }
    await route.fulfill({ contentType: SITE_CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream", body: fs.readFileSync(file) });
  });
}

// -- Pictures of the extension --

// Answers that arrive while a post is on screen blur it; drawn again, a hidden post collapses.
async function openAnsweredFeed(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".brainrot-index-judge").length >= 2, null, { timeout: 15000 });
  await page.evaluate(() => window.redrawFeed());
  await page.waitForFunction(() => document.querySelector('[data-brainrot-index-action="hide"]') !== null, null, { timeout: 5000 });
  await page.mouse.move(1, 1);
  await page.waitForTimeout(400);
}

// Taking a screenshot can drop the page's hover state, so the browser is told to treat the element as
// hovered until the returned function is called.
async function forceHover(page, selector) {
  const devtools = await page.context().newCDPSession(page);
  await devtools.send("DOM.enable");
  await devtools.send("CSS.enable");
  const { root } = await devtools.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await devtools.send("DOM.querySelector", { nodeId: root.nodeId, selector: selector });
  await devtools.send("CSS.forcePseudoState", { nodeId: nodeId, forcedPseudoClasses: ["hover"] });
  await page.waitForTimeout(400);
  return async () => {
    await devtools.send("CSS.forcePseudoState", { nodeId: nodeId, forcedPseudoClasses: [] });
    await devtools.detach();
  };
}

async function hover(page, selector, position) {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + position.x, box.y + position.y, { steps: 4 });
  await page.waitForTimeout(400);
}

async function pictureDataUrl(page, clip) {
  const png = await page.screenshot({ clip: clip });
  return "data:image/png;base64," + png.toString("base64");
}

// -- Slides --

function slideHtml(markDataUrl, { headline, text, pictures, footnote }) {
  const picturesHtml = pictures.map(({ dataUrl, width, height, style = "" }) =>
    `<img src="${dataUrl}" style="width:${width}px; height:${height}px; border-radius:14px; box-shadow:0 0 0 1px rgba(255,255,255,0.12), 0 24px 60px rgba(0,0,0,0.45); ${style}">`).join("");
  const footnoteHtml = footnote
    ? `<div style="position:absolute; left:64px; bottom:36px; font-size:13px; color:rgba(255,255,255,0.4)">${footnote}</div>`
    : "";
  return `<!doctype html><html><body style="margin:0; width:${SLIDE_WIDTH}px; height:${SLIDE_HEIGHT}px; overflow:hidden; position:relative;
      background: radial-gradient(ellipse at 20% 15%, ${NAVY_800}, ${NAVY_950} 70%); color:white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
    <div style="position:absolute; left:64px; top:0; bottom:0; width:340px; display:flex; flex-direction:column; justify-content:center">
      <div style="display:flex; align-items:center; gap:12px">
        <img src="${markDataUrl}" style="width:56px; height:56px">
        <span style="font-size:24px; font-weight:800; color:${GLOW_300}">BrainRot Index</span>
      </div>
      <div style="margin-top:36px; font-size:44px; font-weight:800; line-height:1.12; letter-spacing:-0.5px;
          background: linear-gradient(90deg, ${GLOW_200}, ${GLOW_300} 45%, ${GLOW_400}); -webkit-background-clip:text; color:transparent">${headline}</div>
      <div style="margin-top:22px; font-size:20px; line-height:1.45; color:rgba(255,255,255,0.75)">${text}</div>
    </div>
    <div style="position:absolute; left:440px; right:48px; top:0; bottom:0; display:flex; align-items:center; justify-content:center; gap:28px">
      ${picturesHtml}
    </div>
    ${footnoteHtml}
  </body></html>`;
}

async function writeSlide(browser, file, html) {
  const page = await browser.newPage({ viewport: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await page.screenshot({ path: file });
    console.log("wrote " + path.relative(REPOSITORY_DIR, file));
  } finally {
    await page.close();
  }
}

// The worker's install handler writes the default address; settings written before it finishes are lost.
async function waitForInstall(serviceWorker) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const stored = await serviceWorker.evaluate(() => chrome.storage.local.get("serverAddress"));
    if (stored.serverAddress !== undefined) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// -- Taking the pictures --

const MADE_UP = "Illustration: the posts, videos and accounts are made up.";

async function takePictures(context, serviceWorker, extensionId) {
  const pictures = {};
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize({ width: 1280, height: 900 });

  // A feed: a hidden post's line hovered, so its reason and Show button appear, and a blurred post.
  await openAnsweredFeed(page, STAND_IN_URLS.x);
  let stopHovering = await forceHover(page,
    `.brainrot-index-notice:has(+ article [href="/${SAMPLE_X_TWEETS[1].handle}/status/${SAMPLE_X_TWEETS[1].id}"])`);
  pictures.feed = { dataUrl: await pictureDataUrl(page, { x: 320, y: 0, width: 640, height: 470 }), width: 640 * 1.1, height: 470 * 1.1 };
  await stopHovering();

  // A thread: a hidden reply among replies that are shown, and a blurred post above them.
  await openAnsweredFeed(page, STAND_IN_URLS.reddit);
  stopHovering = await forceHover(page, `shreddit-post#${SAMPLE_REDDIT_POSTS[2].id}`);
  pictures.thread = { dataUrl: await pictureDataUrl(page, { x: 270, y: 0, width: 740, height: 660 }), width: 740 * 0.92, height: 660 * 0.92 };
  await stopHovering();

  // Videos: one hidden, one blurred, the rest shown.
  await openAnsweredFeed(page, STAND_IN_URLS.youtube);
  pictures.videos = { dataUrl: await pictureDataUrl(page, { x: 0, y: 0, width: 1160, height: 760 }), width: 1160 * 0.66, height: 760 * 0.66 };

  // Thumbs down on a shown post, with the details box it opens.
  await openAnsweredFeed(page, STAND_IN_URLS.reddit);
  const shownPost = `shreddit-post#${SAMPLE_REDDIT_POSTS[0].id}`;
  await hover(page, shownPost, { x: 120, y: 30 });
  await page.locator(`${shownPost} .brainrot-index-judge-button[data-verdict="wrong"]`).first().click();
  await page.waitForFunction(() => document.querySelector(".brainrot-index-details-status")?.textContent.endsWith("saved"));
  await page.locator('.brainrot-index-details .brainrot-index-chip[data-value="medium"]').click();
  await page.waitForTimeout(300);
  pictures.thumbs = { dataUrl: await pictureDataUrl(page, { x: 270, y: 0, width: 740, height: 420 }), width: 740 * 0.7, height: 420 * 0.7 };
  await page.keyboard.press("Escape");

  // The toolbar popup, opened as a page of its own, after the feeds above were checked.
  const popupPage = await context.newPage();
  await popupPage.setViewportSize({ width: 284, height: 600 });
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.waitForFunction(() => document.getElementById("account-status").textContent !== "Checking account...");
  await popupPage.waitForTimeout(300);
  const popupBox = await popupPage.locator("body").boundingBox();
  const popupHeight = Math.ceil(popupBox.height + 24);
  pictures.popup = { dataUrl: await pictureDataUrl(popupPage, { x: 0, y: 0, width: 284, height: popupHeight }), width: 284 * 0.85, height: popupHeight * 0.85 };
  await popupPage.close();

  // The dashboard's plugin settings.
  await serveSiteBuild(context);
  const sitePage = await context.newPage();
  // Tall enough that the plugins card is drawn without scrolling, clear of the site's sticky header.
  await sitePage.setViewportSize({ width: 760, height: 2400 });
  await sitePage.goto(SITE_ORIGIN + "/dashboard");
  const pluginsCard = sitePage.locator("div", { has: sitePage.getByRole("heading", { name: "My plugins" }) }).last();
  await pluginsCard.waitFor();
  await sitePage.getByRole("checkbox", { name: "Ragebait on" }).waitFor();
  await sitePage.waitForTimeout(400);
  const cardBox = await pluginsCard.boundingBox();
  const cardHeight = Math.min(cardBox.height, 700);
  pictures.dashboard = {
    dataUrl: await pictureDataUrl(sitePage, { x: cardBox.x - 16, y: cardBox.y - 16, width: cardBox.width + 32, height: cardHeight + 32 }),
    width: (cardBox.width + 32) * 0.98, height: (cardHeight + 32) * 0.98,
  };
  await sitePage.close();
  return pictures;
}

fs.mkdirSync(outputDir, { recursive: true });
MOCK_CONFIG.pending_action = "allow"; // as for an adult account on the real server
const markDataUrl = "data:image/png;base64," + fs.readFileSync(MARK_FILE).toString("base64");
const mockServer = await startMockServer(MOCK_PORT);
try {
  const context = await chromium.launchPersistentContext(makeFreshProfileDir("webstore"), {
    executablePath: BRAVE_BINARY,
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: PICTURE_SCALE,
  });
  let pictures;
  try {
    let serviceWorker = context.serviceWorkers()[0];
    if (serviceWorker === undefined) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15000 });
    }
    const extensionId = new URL(serviceWorker.url()).host;
    await serveStandInPages(context, samplePages({ x: "dark", reddit: "light", youtube: "dark" }));
    await waitForInstall(serviceWorker);
    await serviceWorker.evaluate(async ([address, token]) => {
      await chrome.storage.local.set({ serverAddress: address, token: token, extensionEnabled: true });
    }, [`http://127.0.0.1:${MOCK_PORT}`, MOCK_TOKEN]);
    pictures = await takePictures(context, serviceWorker, extensionId);
  } finally {
    await context.close();
  }

  const slides = [
    { headline: "The algorithm that works for you",
      text: "Your feeds are tuned to keep you scrolling. BrainRot Index is tuned by you: posts your filters flag are blurred or folded into one line that says why.",
      pictures: [pictures.feed], footnote: MADE_UP },
    { headline: "Every post and reply, checked as you scroll",
      text: "AI reads each post with its text and images. Replies in a thread are checked too, and one click shows anything that was filtered.",
      pictures: [pictures.thread], footnote: MADE_UP },
    { headline: "Videos too",
      text: "Suggested and searched videos are judged by their title and thumbnail, and by their captions when they have them.",
      pictures: [pictures.videos], footnote: MADE_UP },
    { headline: "You choose what goes",
      text: "Turn each filter on or off, set how strict it is, and choose whether flagged posts are blurred or hidden.",
      pictures: [pictures.dashboard] },
    { headline: "Tell it when it is wrong",
      text: "Thumbs up or down on any post teaches the filters. The toolbar button switches filtering off and shows what was checked.",
      pictures: [{ ...pictures.thumbs, style: "align-self:center" }, pictures.popup], footnote: MADE_UP },
  ];
  const browser = await chromium.launch({ executablePath: BRAVE_BINARY, headless: true });
  try {
    for (const [index, slide] of slides.entries()) {
      await writeSlide(browser, path.join(outputDir, `screenshot-${index + 1}-1280x800.png`), slideHtml(markDataUrl, slide));
    }
  } finally {
    await browser.close();
  }
} finally {
  mockServer.close();
}
