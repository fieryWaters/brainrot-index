// Prints what a live feed or thread page's markup looks like, so a site adapter can be written or
// fixed from what the site actually serves. Read only: it loads a page, scrolls, and reads the DOM.
//
// Usage: node inspect-markup.mjs <url> [profile directory]
// Without a profile directory a fresh empty profile is used (logged out).
import { makeFreshProfileDir, launchBrave } from "./browser.mjs";

const url = process.argv[2];
const profileDir = process.argv[3] ?? makeFreshProfileDir("inspect");
const { context } = await launchBrave(profileDir);
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(3000);
  const report = await page.evaluate(() => {
    function describe(element) {
      const attributes = {};
      for (const attribute of element.attributes) {
        attributes[attribute.name] = attribute.value.slice(0, 120);
      }
      return { tag: element.tagName.toLowerCase(), attributes };
    }
    const testIdCounts = {};
    for (const element of document.querySelectorAll("[data-testid]")) {
      const testId = element.getAttribute("data-testid");
      testIdCounts[testId] = (testIdCounts[testId] ?? 0) + 1;
    }
    const tweets = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const comments = [...document.querySelectorAll("shreddit-comment")];
    return {
      title: document.title,
      bodyStart: document.body.innerText.slice(0, 300).replace(/\s+/g, " "),
      testIdCounts,
      articleCount: document.querySelectorAll("article").length,
      tweetCount: tweets.length,
      tweets: tweets.slice(0, 4).map((tweet) => ({
        statusLinks: [...tweet.querySelectorAll('a[href*="/status/"]')].map((link) => ({
          href: link.getAttribute("href"),
          hasTime: link.querySelector("time") !== null,
        })),
        userName: tweet.querySelector('[data-testid="User-Name"]')?.textContent,
        text: tweet.querySelector('[data-testid="tweetText"]')?.textContent.slice(0, 100),
        photos: [...tweet.querySelectorAll('[data-testid="tweetPhoto"] img')].map((image) => image.src.slice(0, 100)),
        cellParentTestId: tweet.closest('[data-testid="cellInnerDiv"]') !== null,
      })),
      redditPostCount: document.querySelectorAll("shreddit-post").length,
      redditPermalinks: [...document.querySelectorAll("shreddit-post")].slice(0, 3).map((post) => post.getAttribute("permalink")),
      commentCount: comments.length,
      comments: comments.slice(0, 3).map((comment) => ({
        ...describe(comment),
        slots: [...comment.children].map((child) => child.getAttribute("slot") + ":" + child.tagName.toLowerCase()),
        bodyText: comment.querySelector('[slot="comment"]')?.textContent.trim().slice(0, 100),
      })),
    };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
}
