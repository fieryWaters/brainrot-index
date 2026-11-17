// Draws every picture of the brand mark from brand/logo-source.webp, the logo as supplied:
//   brand/mark-transparent.png    the shield and its glow with the navy background taken out
//   brand/mark-app-icon.png       the shield on a navy rounded square
//   extension/icons/icon16, 32, 48 and 128 (the 128 icon has the Web Store's 16 pixel transparent margin)
//   the site's favicon.ico, favicon-32.png, favicon-192.png, apple-touch-icon.png, logo-mark.webp
//     and its social preview image og-image.png (1200 x 630)
//   docs/webstore/promo-tile-440x280.png, the Web Store's small promo tile
// Run with `node make-icons.mjs` after changing the source; the pictures are committed.
// The source's bottom right corner carries a sparkle and a caption; every crop stays clear of it.
import { chromium } from "playwright-core";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { EXTENSION_DIR, TESTS_DIR } from "./browser.mjs";

const BRAVE_BINARY = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const REPOSITORY_DIR = path.resolve(TESTS_DIR, "..");
const BRAND_DIR = path.join(REPOSITORY_DIR, "brand");
const SITE_PUBLIC_DIR = path.join(REPOSITORY_DIR, "frontend", "brainrot-index-frontend", "public");
const WEBSTORE_DIR = path.join(REPOSITORY_DIR, "docs", "webstore");
const SOURCE_FILE = path.join(BRAND_DIR, "logo-source.webp");

// The brand palette, sampled from the logo. The site defines the same values in src/index.css.
const NAVY_950 = "#0b1830";
const NAVY_800 = "#183453";
const NAVY_700 = "#225172";
const GLOW_200 = "#d2ffff";
const GLOW_300 = "#9eeef5";
const GLOW_400 = "#4cbbe1";

// Where the shield sits in the 1024 pixel source, found by eye and checked against its brightest blue.
const SHIELD_LEFT = 229;
const SHIELD_TOP = 196;
const SHIELD_RIGHT = 794;
const SHIELD_BOTTOM = 835;
// The glow reaches about this far past the shield's edge.
const GLOW_REACH = 40;
// The sparkle and caption start below and to the right of this point.
const CAPTION_LEFT = 760;
const CAPTION_TOP = 900;

// -- Taking the background out --

// The background is a smooth navy gradient. It is modelled as a cubic polynomial in x and y for each
// colour channel, fitted by least squares to the pixels well away from the shield and the caption.
function cubicTerms(x, y) {
  return [1, x, y, x * x, x * y, y * y, x * x * x, x * x * y, x * y * y, y * y * y];
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const rows = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = rows[row][column] / rows[column][column];
      for (let k = column; k <= size; k++) rows[row][k] -= factor * rows[column][k];
    }
  }
  return rows.map((row, index) => row[size] / row[index]);
}

function isBackgroundSample(x, y) {
  const nearShield = x > SHIELD_LEFT - 2 * GLOW_REACH && x < SHIELD_RIGHT + 2 * GLOW_REACH
    && y > SHIELD_TOP - 2 * GLOW_REACH && y < SHIELD_BOTTOM + 2 * GLOW_REACH;
  const inCaption = x > CAPTION_LEFT - GLOW_REACH && y > CAPTION_TOP - GLOW_REACH;
  return !nearShield && !inCaption;
}

function fitBackground(pixels, width, height) {
  const termCount = cubicTerms(0, 0).length;
  const normalMatrix = Array.from({ length: termCount }, () => new Array(termCount).fill(0));
  const normalVectors = [0, 1, 2].map(() => new Array(termCount).fill(0));
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      if (!isBackgroundSample(x, y)) continue;
      const terms = cubicTerms(x / width, y / height);
      for (let i = 0; i < termCount; i++) {
        for (let j = 0; j < termCount; j++) normalMatrix[i][j] += terms[i] * terms[j];
        for (let channel = 0; channel < 3; channel++) {
          normalVectors[channel][i] += terms[i] * pixels[(y * width + x) * 3 + channel];
        }
      }
    }
  }
  const coefficients = normalVectors.map((vector) => solveLinearSystem(normalMatrix, vector));
  return (x, y) => {
    const terms = cubicTerms(x / width, y / height);
    return coefficients.map((channelCoefficients) =>
      channelCoefficients.reduce((sum, coefficient, i) => sum + coefficient * terms[i], 0));
  };
}

// How opaque a pixel must be for it to be this much brighter than the background behind it, if what
// was laid over the background was as bright as a colour can be. This is the colour-to-alpha method
// of image editors: a faint glow becomes a faint bright colour, not a dark one. Pixels darker than
// the background (the shadow under the shield) count as background, so no dark halo is kept.
function glowAlpha(colour, background) {
  let alpha = 0;
  for (let channel = 0; channel < 3; channel++) {
    const brightening = Math.max(0, colour[channel] - background[channel]);
    alpha = Math.max(alpha, brightening / (255 - background[channel]));
  }
  return alpha;
}

// Pixels the shield covers completely: the clearly visible ones, plus everything they enclose (the
// dark inner line of the shield is close to the background colour, but it is solid).
function solidShieldMask(alphas, width, height) {
  const SOLID_ALPHA = 0.5;
  const outside = new Uint8Array(width * height);
  const queue = [];
  for (let x = 0; x < width; x++) queue.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) queue.push(y * width, y * width + width - 1);
  while (queue.length > 0) {
    const index = queue.pop();
    if (outside[index] === 1 || alphas[index] >= SOLID_ALPHA) continue;
    outside[index] = 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) queue.push(index - 1);
    if (x < width - 1) queue.push(index + 1);
    if (y > 0) queue.push(index - width);
    if (y < height - 1) queue.push(index + width);
  }
  return outside.map((isOutside) => 1 - isOutside);
}

// The source with its background taken out, as RGBA pixels the size of the source.
async function extractMark() {
  const { data: pixels, info } = await sharp(SOURCE_FILE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  // The glow is smooth, but the source has fine grain in it. The glow is read from a slightly blurred
  // copy so the grain does not turn into speckles on a light page.
  const smoothPixels = await sharp(SOURCE_FILE).removeAlpha().blur(2).raw().toBuffer();
  const backgroundAt = fitBackground(smoothPixels, width, height);

  // What is left of the grain after blurring reads as a few percent of alpha; below this it counts as background.
  const NOISE_ALPHA = 0.08;
  const backgrounds = new Float32Array(width * height * 3);
  const alphas = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const background = backgroundAt(x, y);
      backgrounds.set(background, index * 3);
      const colour = [smoothPixels[index * 3], smoothPixels[index * 3 + 1], smoothPixels[index * 3 + 2]];
      const rawAlpha = glowAlpha(colour, background);
      alphas[index] = Math.max(0, (rawAlpha - NOISE_ALPHA) / (1 - NOISE_ALPHA));
    }
  }
  const solid = solidShieldMask(alphas, width, height);

  const mark = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const isSolid = solid[index] === 1;
    const alpha = isSolid ? 1 : alphas[index];
    for (let channel = 0; channel < 3; channel++) {
      const colour = isSolid ? pixels[index * 3 + channel] : smoothPixels[index * 3 + channel];
      const background = backgrounds[index * 3 + channel];
      // Undo the blend with the background: colour = alpha * markColour + (1 - alpha) * background.
      const markColour = alpha > 0 ? background + (colour - background) / alpha : 0;
      mark[index * 4 + channel] = Math.round(Math.min(255, Math.max(0, markColour)));
    }
    mark[index * 4 + 3] = Math.round(alpha * 255);
  }
  return sharp(mark, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// -- Crops of the mark --

// A square around the shield's centre, side pixels wide.
function squareAroundShield(side) {
  const centreX = (SHIELD_LEFT + SHIELD_RIGHT) / 2;
  const centreY = (SHIELD_TOP + SHIELD_BOTTOM) / 2;
  return { left: Math.round(centreX - side / 2), top: Math.round(centreY - side / 2), width: side, height: side };
}

const SHIELD_HEIGHT = SHIELD_BOTTOM - SHIELD_TOP;
// The shield with its glow, for use at sizes where the glow shows.
const GLOWING_CROP = squareAroundShield(SHIELD_HEIGHT + 2 * GLOW_REACH);
// The shield alone, edge to edge, for toolbar and tab sizes where every pixel counts.
const TIGHT_CROP = squareAroundShield(SHIELD_HEIGHT + 8);

function assertClearOfCaption(crop) {
  if (crop.left + crop.width > CAPTION_LEFT && crop.top + crop.height > CAPTION_TOP) {
    throw new Error("crop reaches the caption corner of the source");
  }
}
assertClearOfCaption(GLOWING_CROP);
assertClearOfCaption(TIGHT_CROP);

// At toolbar and tab sizes a light sharpen keeps the shield's outline from going soft.
const SHARPENED_UP_TO_SIZE = 32;

async function cropMark(markPng, crop, size) {
  const picture = sharp(markPng).extract(crop).resize(size, size, { kernel: "lanczos3" });
  if (size <= SHARPENED_UP_TO_SIZE) picture.sharpen({ sigma: 0.5 });
  return picture.png().toBuffer();
}

// The mark centred on a transparent square, size pixels wide, with margin pixels on every side.
async function markWithMargin(markPng, crop, size, margin) {
  const artwork = await cropMark(markPng, crop, size - 2 * margin);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: artwork, left: margin, top: margin }])
    .png().toBuffer();
}

// The navy of the source, lit from above, as an SVG square with corners rounded by cornerRadius.
function navyBackgroundSvg(size, cornerRadius) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><radialGradient id="navy" cx="0.5" cy="0.3" r="0.85">
      <stop offset="0" stop-color="${NAVY_700}"/><stop offset="0.55" stop-color="${NAVY_800}"/>
      <stop offset="1" stop-color="${NAVY_950}"/>
    </radialGradient></defs>
    <rect width="${size}" height="${size}" rx="${cornerRadius}" fill="url(#navy)"/>
  </svg>`);
}

// The glowing mark on navy, size pixels square, corners rounded by cornerRadius (0 for square).
async function markOnNavy(markPng, size, cornerRadius) {
  const markSize = Math.round(size * 0.78);
  const artwork = await cropMark(markPng, GLOWING_CROP, markSize);
  const offset = Math.round((size - markSize) / 2);
  return sharp(navyBackgroundSvg(size, cornerRadius))
    .composite([{ input: artwork, left: offset, top: offset }])
    .png().toBuffer();
}

// An .ico file holding PNG images, which every current browser reads.
function icoFile(pngImages) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngImages.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngImages.length;
  for (const { size, png } of pngImages) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngImages.map((image) => image.png)]);
}

// -- Pictures drawn as web pages: the social preview and the promo tile --

const FONT = "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;";
const HEADLINE_GRADIENT = `background: linear-gradient(90deg, ${GLOW_200}, ${GLOW_300} 45%, ${GLOW_400});`
  + " -webkit-background-clip: text; color: transparent;";
const PAGE_BACKGROUND = `background: radial-gradient(ellipse at 30% 20%, ${NAVY_800}, ${NAVY_950} 70%);`;

function feedRow(width, opacity, label) {
  const labelHtml = label
    ? `<span style="position:absolute; left:16px; top:50%; transform:translateY(-50%); font-size:18px; font-weight:600;
         color:${GLOW_300}">${label}</span>`
    : "";
  return `<div style="position:relative; height:52px; border-radius:14px; background:rgba(255,255,255,0.06);
      border:1px solid rgba(255,255,255,0.1); margin-bottom:14px">
      <div style="position:absolute; left:16px; top:15px; width:${width}%; height:10px; border-radius:5px;
        background:rgba(255,255,255,${opacity})"></div>
      ${labelHtml}
    </div>`;
}

function socialImageHtml(markDataUrl) {
  return `<body style="margin:0; width:1200px; height:630px; ${PAGE_BACKGROUND} ${FONT}
      display:flex; align-items:center; gap:64px; padding:0 80px; box-sizing:border-box; color:white">
    <div style="flex:1">
      <img src="${markDataUrl}" style="width:132px; height:132px; margin-left:-14px">
      <div style="margin-top:16px; font-size:76px; font-weight:800; letter-spacing:-1px; ${HEADLINE_GRADIENT}">Brainrot Index</div>
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
}

function promoTileHtml(markDataUrl) {
  return `<body style="margin:0; width:440px; height:280px; ${PAGE_BACKGROUND} ${FONT}
      display:flex; align-items:center; gap:20px; padding:0 28px; box-sizing:border-box; color:white">
    <img src="${markDataUrl}" style="width:120px; height:120px; flex:none">
    <div>
      <div style="font-size:36px; font-weight:800; line-height:1.1; ${HEADLINE_GRADIENT}">Brainrot Index</div>
      <div style="margin-top:10px; font-size:18px; line-height:1.35; color:rgba(255,255,255,0.75)">
        A calmer feed<br>on X and Reddit.</div>
    </div>
  </body>`;
}

async function renderPages(pages) {
  const browser = await chromium.launch({ executablePath: BRAVE_BINARY, headless: true });
  try {
    for (const page of pages) {
      const tab = await browser.newPage({ viewport: { width: page.width, height: page.height } });
      await tab.setContent(page.html);
      await tab.evaluate(() => document.fonts.ready);
      await tab.screenshot({ path: page.file });
      await tab.close();
      console.log("wrote " + path.relative(REPOSITORY_DIR, page.file));
    }
  } finally {
    await browser.close();
  }
}

// -- Writing everything --

function write(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  console.log("wrote " + path.relative(REPOSITORY_DIR, file));
}

const fullMark = await extractMark();
const transparentMark = await cropMark(fullMark, GLOWING_CROP, 1024);
write(path.join(BRAND_DIR, "mark-transparent.png"), transparentMark);
write(path.join(BRAND_DIR, "mark-app-icon.png"), await markOnNavy(fullMark, 1024, 224));

write(path.join(EXTENSION_DIR, "icons", "icon16.png"), await cropMark(fullMark, TIGHT_CROP, 16));
write(path.join(EXTENSION_DIR, "icons", "icon32.png"), await cropMark(fullMark, TIGHT_CROP, 32));
write(path.join(EXTENSION_DIR, "icons", "icon48.png"), await markWithMargin(fullMark, TIGHT_CROP, 48, 2));
write(path.join(EXTENSION_DIR, "icons", "icon128.png"), await markWithMargin(fullMark, GLOWING_CROP, 128, 16));

const favicon16 = await cropMark(fullMark, TIGHT_CROP, 16);
const favicon32 = await cropMark(fullMark, TIGHT_CROP, 32);
const favicon48 = await cropMark(fullMark, TIGHT_CROP, 48);
write(path.join(SITE_PUBLIC_DIR, "favicon.ico"),
  icoFile([{ size: 16, png: favicon16 }, { size: 32, png: favicon32 }, { size: 48, png: favicon48 }]));
write(path.join(SITE_PUBLIC_DIR, "favicon-32.png"), favicon32);
write(path.join(SITE_PUBLIC_DIR, "favicon-192.png"), await cropMark(fullMark, GLOWING_CROP, 192));
write(path.join(SITE_PUBLIC_DIR, "apple-touch-icon.png"), await markOnNavy(fullMark, 180, 0));
write(path.join(SITE_PUBLIC_DIR, "logo-mark.webp"),
  await sharp(await cropMark(fullMark, GLOWING_CROP, 384)).webp({ quality: 90, alphaQuality: 100 }).toBuffer());

const markDataUrl = "data:image/png;base64," + (await cropMark(fullMark, GLOWING_CROP, 384)).toString("base64");
await renderPages([
  { file: path.join(SITE_PUBLIC_DIR, "og-image.png"), width: 1200, height: 630, html: socialImageHtml(markDataUrl) },
  { file: path.join(WEBSTORE_DIR, "promo-tile-440x280.png"), width: 440, height: 280, html: promoTileHtml(markDataUrl) },
]);
