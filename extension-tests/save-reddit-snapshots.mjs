// Saves the posts of a few live Reddit feeds as fixtures, so the Reddit adapter can be tested against
// Reddit's real markup without asking Reddit again. Read only, logged out, and without the extension.
//
// Usage: node save-reddit-snapshots.mjs <output file> <url>...
// The file holds one post of each kind found (text, image, gallery, video, gif, link, ...), the first
// seen, with class and style attributes removed. fixtures/reddit-posts.html was made this way.
import { chromium } from "playwright-core";
import fs from "node:fs";
import { makeFreshProfileDir } from "./browser.mjs";

const BRAVE_BINARY = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const SCROLLS_PER_PAGE = 4;

const [outputFile, ...urls] = process.argv.slice(2);
const context = await chromium.launchPersistentContext(makeFreshProfileDir("reddit-snapshots"), {
  executablePath: BRAVE_BINARY,
  headless: false,
  viewport: { width: 1280, height: 900 },
});
const postByType = new Map();
try {
  const page = context.pages()[0] ?? (await context.newPage());
  for (const url of urls) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    for (let scroll = 0; scroll <= SCROLLS_PER_PAGE; scroll++) {
      const posts = await page.evaluate(() => [...document.querySelectorAll("shreddit-post")].map((post) => {
        // Styling is left out: it is most of the markup and nothing the adapter reads.
        const copy = post.cloneNode(true);
        for (const element of [copy, ...copy.querySelectorAll("*")]) {
          element.removeAttribute("class");
          element.removeAttribute("style");
        }
        return { type: post.getAttribute("post-type"), html: copy.outerHTML };
      }));
      for (const post of posts) {
        if (!postByType.has(post.type)) {
          postByType.set(post.type, post.html);
        }
      }
      await page.mouse.wheel(0, 2000);
      await page.waitForTimeout(2000);
    }
  }
} finally {
  await context.close();
}
const fixture = `<!-- ${urls.join(" ")}, saved ${new Date().toISOString()} -->\n` + [...postByType.values()].join("\n");
fs.writeFileSync(outputFile, fixture);
console.log("post types:", [...postByType.keys()].join(", "));
