// Pictures of how a hidden or blurred post and the thumbs look, on the stand-in pages for X, Reddit
// and YouTube (stand-in-pages.mjs) with the mock server, so no real site is asked. Variant A is what
// the extension ships; B and C are alternatives drawn by adding the stylesheets below to the page.
//
// Usage: node screenshot-feedback-ui.mjs [output folder]   (default: ../docs/screenshots/feedback-hover-ui)
// The output folder gets one sheet per site comparing the hidden-post variants, and one comparing the
// thumbs variants with the details box.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeFreshProfileDir, withBrave, TESTS_DIR } from "./browser.mjs";
import { startMockServer, MOCK_TOKEN, MOCK_CONFIG } from "./mock-server.mjs";
import { SAMPLE_REDDIT_POSTS, SAMPLE_X_TWEETS, SAMPLE_YOUTUBE_VIDEOS, STAND_IN_URLS, samplePages, serveStandInPages } from "./stand-in-pages.mjs";

const MOCK_PORT = 8787;
const outputDir = path.resolve(process.argv[2] ?? path.join(TESTS_DIR, "..", "docs", "screenshots", "feedback-hover-ui"));
// Each picture on its own goes to a temporary folder; the output folder gets the sheets combining them.
const partsDir = fs.mkdtempSync(path.join(os.tmpdir(), "brainrot-feedback-ui-"));

const LINE = "html .brainrot-index-notice:not(.brainrot-index-notice-over-post)";
const PILL = "html .brainrot-index-notice-over-post";

// B: the hidden post is a hairline across the feed with its label in the middle; the blurred post's
// label is the shield alone until hovered.
const VARIANT_B_CSS = `
  ${LINE} { justify-content: center; min-height: 30px; background: transparent !important; }
  ${LINE}::before, ${LINE}::after { content: ""; flex: 1 1 0; border-top: 1px solid rgba(128, 128, 128, 0.25); }
  ${LINE} .brainrot-index-actions { margin-left: 0; }
  ${LINE}:not(:hover):not(:focus-within) .brainrot-index-detail,
  ${LINE}:not(:hover):not(:focus-within) .brainrot-index-actions { display: none; }
  ${PILL}:not(:hover):not(:has(+ :hover)) { padding: 0; width: 28px; justify-content: center; }
  ${PILL}:not(:hover):not(:has(+ :hover)) .brainrot-index-summary { display: none; }
`;

// C: the hidden post is a soft card with a border; the blurred post's label is A's pill.
const VARIANT_C_CSS = `
  ${LINE} { margin: 8px 12px; padding: 8px 14px; border: 1px solid rgba(128, 128, 128, 0.22); border-radius: 12px; background: rgba(128, 128, 128, 0.07); }
  ${LINE} .brainrot-index-summary { opacity: 0.85; }
`;

// Thumbs variant 2: a small shield in front of the thumbs in a site's row, naming them as BrainRot's.
const SHIELD_DATA_URI = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#3796d1" d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/></svg>');
const THUMBS_WITH_SHIELD_CSS = `
  html .brainrot-index-judge:not(.brainrot-index-actions .brainrot-index-judge)::before {
    content: ""; flex: none; width: 12px; height: 12px; margin: 0 2px 0 6px; background: url("${SHIELD_DATA_URI}") center / contain no-repeat;
  }
`;

const HIDDEN_VARIANTS = [["a", ""], ["b", VARIANT_B_CSS], ["c", VARIANT_C_CSS]];

// What to point at on each site: a shown post, a hidden one and a blurred one.
const SITES = {
  x: {
    url: STAND_IN_URLS.x,
    shown: `article:has(a[href="/${SAMPLE_X_TWEETS[0].handle}/status/${SAMPLE_X_TWEETS[0].id}"])`,
    hidden: `.brainrot-index-notice:has(+ article [href="/${SAMPLE_X_TWEETS[1].handle}/status/${SAMPLE_X_TWEETS[1].id}"])`,
    blurred: `article:has(a[href="/${SAMPLE_X_TWEETS[2].handle}/status/${SAMPLE_X_TWEETS[2].id}"])`,
    clip: { x: 340, y: 0, width: 600, height: 620 },
  },
  reddit: {
    url: STAND_IN_URLS.reddit,
    shown: `shreddit-post#${SAMPLE_REDDIT_POSTS[0].id}`,
    hidden: `.brainrot-index-notice:has(+ shreddit-post#${SAMPLE_REDDIT_POSTS[1].id})`,
    blurred: `shreddit-post#${SAMPLE_REDDIT_POSTS[2].id}`,
    clip: { x: 260, y: 0, width: 760, height: 760 },
  },
  youtube: {
    url: STAND_IN_URLS.youtube,
    shown: `yt-lockup-view-model:has(h3 a[href="/watch?v=${SAMPLE_YOUTUBE_VIDEOS[0].id}"])`,
    hidden: `.brainrot-index-notice:has(+ yt-lockup-view-model h3 a[href="/watch?v=${SAMPLE_YOUTUBE_VIDEOS[1].id}"])`,
    blurred: `yt-lockup-view-model:has(h3 a[href="/watch?v=${SAMPLE_YOUTUBE_VIDEOS[3].id}"])`,
    clip: { x: 0, y: 0, width: 1160, height: 720 },
  },
};

async function openAnswered(page, site) {
  await page.goto(SITES[site].url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".brainrot-index-judge").length >= 2, null, { timeout: 15000 });
  // Answers that arrive while a post is on screen blur it; drawn again, a hidden post collapses.
  await page.evaluate(() => window.redrawFeed());
  await page.waitForFunction(() => document.querySelector('[data-brainrot-index-action="hide"]') !== null, null, { timeout: 5000 });
  await page.mouse.move(1270, 890);
  await page.waitForTimeout(400);
}

async function shoot(page, site, name) {
  const filePath = path.join(partsDir, `${site}-${name}.png`);
  await page.screenshot({ path: filePath, clip: SITES[site].clip });
  return filePath;
}

// The pointer is moved by hand: Playwright's own hover misplaces it on a blurred element.
async function hover(page, selector, position = { x: 20, y: 10 }) {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + position.x, box.y + position.y, { steps: 4 });
  await page.waitForTimeout(400);
}

// Taking a screenshot can drop the page's hover state, so for pictures of a hovered line or post the
// browser is told to treat the element as hovered until the next page load.
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

// Pictures side by side with a caption above each, in one image, laid out and photographed in a page
// of its own.
async function contactSheet(context, fileName, rows) {
  const rowsHtml = rows.map((row) => "<tr>" + row.map(([caption, filePath]) =>
    `<td><p>${caption}</p><img src="data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}"></td>`).join("") + "</tr>");
  const sheetPage = await context.newPage();
  try {
    await sheetPage.setContent(`<!doctype html><style>
      body { margin: 0; background: #f2f2f2; font: 18px Helvetica, Arial, sans-serif; color: #222; }
      table { border-spacing: 16px; } td { vertical-align: top; padding: 0; } p { margin: 0 0 8px; }
      img { display: block; box-shadow: 0 0 0 1px #ccc; }
    </style><table>${rowsHtml.join("")}</table>`);
    await sheetPage.locator("table").screenshot({ path: path.join(outputDir, fileName) });
  } finally {
    await sheetPage.close();
  }
}

fs.mkdirSync(outputDir, { recursive: true });
MOCK_CONFIG.pending_action = "allow"; // as for an adult account on the real server
const mockServer = await startMockServer(MOCK_PORT);
try {
  await withBrave(makeFreshProfileDir("screenshots"), {}, async ({ context, serviceWorker }) => {
    await serveStandInPages(context, samplePages({ x: "dark", reddit: "light", youtube: "light" }));
    await waitForInstall(serviceWorker);
    await serviceWorker.evaluate(async ([address, token]) => {
      await chrome.storage.local.set({ serverAddress: address, token: token, extensionEnabled: true });
    }, [`http://127.0.0.1:${MOCK_PORT}`, MOCK_TOKEN]);
    const page = context.pages()[0] ?? (await context.newPage());

    const hiddenShots = {};
    for (const site of ["x", "reddit", "youtube"]) {
      hiddenShots[site] = {};
      for (const [variant, css] of HIDDEN_VARIANTS) {
        await openAnswered(page, site);
        if (css !== "") {
          await page.addStyleTag({ content: css });
        }
        const resting = await shoot(page, site, `hidden-${variant}-resting`);
        let stopHovering = await forceHover(page, SITES[site].hidden);
        const hoverHidden = await shoot(page, site, `hidden-${variant}-hover-hidden-line`);
        await stopHovering();
        stopHovering = await forceHover(page, SITES[site].blurred);
        const hoverBlurred = await shoot(page, site, `hidden-${variant}-hover-blurred-post`);
        await stopHovering();
        hiddenShots[site][variant] = [resting, hoverHidden, hoverBlurred];
      }
    }

    const thumbsShots = {};
    for (const site of ["x", "reddit", "youtube"]) {
      await openAnswered(page, site);
      await hover(page, SITES[site].shown, { x: 120, y: 30 });
      const plain = await shoot(page, site, "thumbs-1-hover-shown-post");
      await page.addStyleTag({ content: THUMBS_WITH_SHIELD_CSS });
      await page.mouse.move(1270, 890);
      await hover(page, SITES[site].shown, { x: 120, y: 30 });
      const withShield = await shoot(page, site, "thumbs-2-with-shield-hover-shown-post");
      await openAnswered(page, site);
      await hover(page, SITES[site].shown, { x: 120, y: 30 });
      await page.locator(`${SITES[site].shown} .brainrot-index-judge-button[data-verdict="wrong"]`).first().click();
      await page.waitForFunction(() => document.querySelector(".brainrot-index-details-status")?.textContent.endsWith("saved"));
      await page.locator('.brainrot-index-details .brainrot-index-chip[data-value="medium"]').click();
      const details = await shoot(page, site, "thumbs-details-box-after-thumbs-down");
      thumbsShots[site] = [plain, withShield, details];
      await page.keyboard.press("Escape");
    }

    for (const site of ["x", "reddit", "youtube"]) {
      await contactSheet(context, `sheet-${site}-hidden-post-variants.png`, HIDDEN_VARIANTS.map(([variant]) => [
        [`${variant.toUpperCase()}: resting`, hiddenShots[site][variant][0]],
        [`${variant.toUpperCase()}: hovering the hidden line`, hiddenShots[site][variant][1]],
        [`${variant.toUpperCase()}: hovering the blurred post`, hiddenShots[site][variant][2]],
      ]));
    }
    await contactSheet(context, "sheet-thumbs-variants.png", ["x", "reddit", "youtube"].map((site) => [
      [`${site}: 1, thumbs only (hover)`, thumbsShots[site][0]],
      [`${site}: 2, shield and thumbs (hover)`, thumbsShots[site][1]],
      [`${site}: details box after thumbs down`, thumbsShots[site][2]],
    ]));
  });
} finally {
  mockServer.close();
}
console.log("sheets in " + outputDir + ", single pictures in " + partsDir);

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
