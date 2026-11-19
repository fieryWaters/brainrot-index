// Saves the tweets of a few live X pages as fixtures, so the X adapter can be tested against X's real
// markup without asking X again. Read only, and without the extension: it loads each page in the
// signed-in test profile, scrolls a little, and writes every timeline cell holding a tweet.
//
// Usage: node save-x-snapshots.mjs <output directory> <url>...
// Each page becomes <output directory>/<name>.html, named after its path. fixtures/x-tweets.html is
// a few tweets picked from such files: a quote, a link card, a GIF, videos, several photos.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const X_TEST_PROFILE_DIR = "/Users/jacob/git-repos/brainrot-test-profile";
const BRAVE_BINARY = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const SCROLLS_PER_PAGE = 4;

const [outputDir, ...urls] = process.argv.slice(2);
fs.mkdirSync(outputDir, { recursive: true });

// The cookies of a profile signed in by hand are encrypted with the macOS keychain, so Playwright's
// stand-in keychain is left out.
const context = await chromium.launchPersistentContext(X_TEST_PROFILE_DIR, {
  executablePath: BRAVE_BINARY,
  headless: false,
  ignoreDefaultArgs: ["--use-mock-keychain"],
  viewport: { width: 1280, height: 900 },
});
try {
  const page = context.pages()[0] ?? (await context.newPage());
  for (const url of urls) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    // Cells are collected while scrolling, because X removes the ones far from the viewport.
    const cellsByKey = new Map();
    for (let scroll = 0; scroll <= SCROLLS_PER_PAGE; scroll++) {
      const cells = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
          .filter((cell) => cell.querySelector('article[data-testid="tweet"]') !== null)
          .map((cell) => {
            // Styling is left out: it is most of the markup and nothing the adapter reads.
            const copy = cell.cloneNode(true);
            for (const element of [copy, ...copy.querySelectorAll("*")]) {
              element.removeAttribute("class");
              element.removeAttribute("style");
            }
            return {
              key: cell.querySelector('a[href*="/status/"] time')?.closest("a").getAttribute("href") ?? cell.outerHTML.slice(0, 200),
              html: copy.outerHTML,
            };
          }));
      for (const cell of cells) {
        cellsByKey.set(cell.key, cell.html);
      }
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(2500);
    }
    const name = new URL(url).pathname.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "home";
    const fixture = `<!-- ${url}, saved ${new Date().toISOString()} -->\n` + [...cellsByKey.values()].join("\n");
    fs.writeFileSync(path.join(outputDir, name + ".html"), fixture);
    console.log(`${name}: ${cellsByKey.size} tweets`);
  }
} finally {
  await context.close();
}
