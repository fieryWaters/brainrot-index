// Draws every picture of the brand mark from the site's favicon.svg, in headless Brave:
//   extension/icons/icon16, 32, 48 and 128 (the 128 icon has the Web Store's 16 pixel transparent margin)
//   the site's apple-touch-icon.png and its social preview image og-image.png (1200 x 630)
//   docs/webstore/promo-tile-440x280.png, the Web Store's small promo tile
// Run with `node make-icons.mjs` after changing favicon.svg; the PNG files are committed.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_DIR, TESTS_DIR } from "./browser.mjs";

const BRAVE_BINARY = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const REPOSITORY_DIR = path.resolve(TESTS_DIR, "..");
const SITE_PUBLIC_DIR = path.join(REPOSITORY_DIR, "frontend", "brainrot-index-frontend", "public");
const WEBSTORE_DIR = path.join(REPOSITORY_DIR, "docs", "webstore");

const markSvg = fs.readFileSync(path.join(SITE_PUBLIC_DIR, "favicon.svg"), "utf8");
const markDataUrl = "data:image/svg+xml;base64," + Buffer.from(markSvg).toString("base64");

const FONT = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;";
const HEADLINE_GRADIENT = "background: linear-gradient(90deg, #fbbf24, #f97316, #f43f5e);"
  + " -webkit-background-clip: text; color: transparent;";

// The mark alone, size pixels square, with margin pixels of transparency on every side.
function iconHtml(size, margin) {
  const markSize = size - 2 * margin;
  return `<body style="margin:0; background:transparent">
    <img src="${markDataUrl}" style="display:block; margin:${margin}px; width:${markSize}px; height:${markSize}px">
  </body>`;
}

function feedRow(width, opacity, label) {
  const labelHtml = label
    ? `<span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:18px; font-weight:600;
         color:#fcd34d">${label}</span>`
    : "";
  return `<div style="position:relative; height:52px; border-radius:14px; background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.1); margin-bottom:14px">
      <div style="position:absolute; left:16px; top:15px; width:${width}%; height:10px; border-radius:5px;
        background:rgba(255,255,255,${opacity})"></div>
      ${labelHtml}
    </div>`;
}

const SOCIAL_IMAGE_HTML = `<body style="margin:0; width:1200px; height:630px; background:#030712; ${FONT}
    display:flex; align-items:center; gap:64px; padding:0 80px; box-sizing:border-box; color:white">
  <div style="flex:1">
    <img src="${markDataUrl}" style="width:96px; height:96px">
    <div style="margin-top:28px; font-size:76px; font-weight:800; letter-spacing:-1px; ${HEADLINE_GRADIENT}">Brainrot Index</div>
    <div style="margin-top:20px; font-size:32px; line-height:1.35; color:rgba(255,255,255,0.75)">
      Filters brainrot, ragebait and engagement bait out of your X and Reddit feeds.</div>
  </div>
  <div style="width:380px">
    ${feedRow(70, 0.35)}
    ${feedRow(0, 0, "Hidden: Ragebait")}
    ${feedRow(55, 0.35)}
    ${feedRow(0, 0, "Hidden: Engagement bait")}
    ${feedRow(80, 0.35)}
  </div>
</body>`;

const PROMO_TILE_HTML = `<body style="margin:0; width:440px; height:280px; background:#030712; ${FONT}
    display:flex; flex-direction:column; justify-content:center; padding:0 36px; box-sizing:border-box; color:white">
  <img src="${markDataUrl}" style="width:64px; height:64px">
  <div style="margin-top:18px; font-size:38px; font-weight:800; ${HEADLINE_GRADIENT}">Brainrot Index</div>
  <div style="margin-top:8px; font-size:18px; line-height:1.35; color:rgba(255,255,255,0.75)">
    A calmer feed on X and Reddit.</div>
</body>`;

const pictures = [
  { file: path.join(EXTENSION_DIR, "icons", "icon16.png"), width: 16, height: 16, html: iconHtml(16, 0) },
  { file: path.join(EXTENSION_DIR, "icons", "icon32.png"), width: 32, height: 32, html: iconHtml(32, 0) },
  { file: path.join(EXTENSION_DIR, "icons", "icon48.png"), width: 48, height: 48, html: iconHtml(48, 2) },
  { file: path.join(EXTENSION_DIR, "icons", "icon128.png"), width: 128, height: 128, html: iconHtml(128, 16) },
  { file: path.join(SITE_PUBLIC_DIR, "apple-touch-icon.png"), width: 180, height: 180, html: iconHtml(180, 0) },
  { file: path.join(SITE_PUBLIC_DIR, "og-image.png"), width: 1200, height: 630, html: SOCIAL_IMAGE_HTML },
  { file: path.join(WEBSTORE_DIR, "promo-tile-440x280.png"), width: 440, height: 280, html: PROMO_TILE_HTML },
];

const browser = await chromium.launch({ executablePath: BRAVE_BINARY, headless: true });
try {
  for (const picture of pictures) {
    const page = await browser.newPage({ viewport: { width: picture.width, height: picture.height } });
    await page.setContent(picture.html);
    await page.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.dirname(picture.file), { recursive: true });
    await page.screenshot({ path: picture.file, omitBackground: true });
    await page.close();
    console.log("wrote " + path.relative(REPOSITORY_DIR, picture.file));
  }
} finally {
  await browser.close();
}
