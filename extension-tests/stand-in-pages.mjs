// Stand-ins for x.com, www.reddit.com and www.youtube.com, served by Playwright so the real sites are
// never asked. Each page copies only what the extension reads and where it adds its buttons, from the
// sites' markup as of November 2026: X's tweet articles and their row of actions, Reddit's posts and
// comments with their shadow roots and named slots, YouTube's lockup tiles with their "More actions"
// column. The styling is a rough likeness, enough to judge how the extension's additions look.
//
// The mock server decides each post's treatment from its id (see mock-server.mjs), so postIdFor picks
// ids that give the treatment a stand-in post asks for.
//
// window.redrawFeed() in a stand-in page draws the feed again with new elements, as the sites do when
// posts scroll far away and back; a post answered "hide" while on screen is then collapsed.

const TREATMENT_GROUP = { hide: 0, blur: 1, allow: 2 };

function characterSum(text) {
  let sum = 0;
  for (const character of text) {
    sum = sum + character.charCodeAt(0);
  }
  return sum;
}

// An id starting with prefix that the mock server answers with this treatment on its second request
// (its first answer is always "pending").
export function postIdFor(prefix, treatment) {
  for (let counter = 0; ; counter++) {
    const postId = prefix + String(counter).padStart(3, "0");
    const sum = characterSum(postId);
    if (sum % 3 === TREATMENT_GROUP[treatment] && sum % 4 !== 3) {
      return postId;
    }
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

function page(title, theme, styles, feedHtml) {
  return `<!doctype html>
<html data-theme="${theme}"${theme === "dark" ? " dark" : ""}>
<head><meta charset="utf-8"><title>${title} (stand-in)</title><style>${styles}</style></head>
<body>
<main id="feed"></main>
<script>
  const feedHtml = ${JSON.stringify(feedHtml)};
  window.redrawFeed = () => { document.getElementById("feed").setHTMLUnsafe(feedHtml); };
  window.redrawFeed();
  window.keyPressesSeenByPage = 0;
  document.addEventListener("keydown", () => { window.keyPressesSeenByPage = window.keyPressesSeenByPage + 1; });
</script>
</body>
</html>`;
}

// -- X --

const X_ICON_PATHS = {
  reply: "M4 12a8 8 0 1 1 3.5 6.6L4 20l1.2-3.6A8 8 0 0 1 4 12z",
  retweet: "M7 7h10v6m0 0 3-3m-3 3-3-3M17 17H7v-6m0 0-3 3m3-3 3 3",
  like: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  views: "M5 20V12M10 20V4M15 20v-9M20 20v-5",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  share: "M12 3v12M7 8l5-5 5 5M5 14v6h14v-6",
  grok: "M5 19 19 5M9 5h10v10",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};

function xIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${X_ICON_PATHS[name]}"/></svg>`;
}

function xActionCell(testId, iconName, count) {
  const countHtml = count === undefined ? "" : `<span>${count}</span>`;
  return `<div class="cell"><button data-testid="${testId}" type="button"><div dir="ltr" class="icon">${xIcon(iconName)}${countHtml}</div></button></div>`;
}

// tweet = { id, name, handle, text, promoted }. A promoted tweet has no timestamp link, as X's ads.
function xTweet(tweet) {
  let when = `<a href="/${tweet.handle}/status/${tweet.id}"><time>2h</time></a>`;
  if (tweet.promoted) {
    when = `<span>Ad</span>`;
  }
  return `<div data-testid="cellInnerDiv"><article data-testid="tweet" role="article">
  <div class="avatar" style="background:${tweet.avatar}"></div>
  <div class="body">
    <div class="head"><b>${escapeHtml(tweet.name)}</b><span class="muted">@${tweet.handle} · ${when}</span><div class="top-right"><div><button aria-label="Grok actions" type="button" class="icon">${xIcon("grok")}</button></div><div><div><button aria-label="More" data-testid="caret" type="button" class="icon">${xIcon("more")}</button></div></div></div></div>
    <div data-testid="tweetText">${escapeHtml(tweet.text)}</div>
    <div role="group" aria-label="actions">
      ${xActionCell("reply", "reply", tweet.replies ?? 12)}
      ${xActionCell("retweet", "retweet", 4)}
      ${xActionCell("like", "like", tweet.likes ?? 188)}
      <div class="cell"><a href="/${tweet.handle}/status/${tweet.id}/analytics" class="views"><div dir="ltr" class="icon">${xIcon("views")}<span>15K</span></div></a></div>
      ${xActionCell("bookmark", "bookmark")}
      <div class="cell"><button aria-label="Share post" type="button"><div dir="ltr" class="icon">${xIcon("share")}</div></button></div>
    </div>
  </div>
</article></div>`;
}

const X_STYLES = `
  html { --background: #fff; --text: #0f1419; --muted: rgb(83, 100, 113); --border: #eff3f4; }
  html[data-theme="dark"] { --background: #000; --text: #e7e9ea; --muted: rgb(113, 118, 123); --border: #2f3336; }
  body { margin: 0; background: var(--background); color: var(--text); font: 15px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  #feed { width: 600px; margin: 0 auto; border-left: 1px solid var(--border); border-right: 1px solid var(--border); min-height: 100vh; }
  [data-testid="cellInnerDiv"] { border-bottom: 1px solid var(--border); }
  article { display: flex; gap: 12px; padding: 12px 16px 6px; }
  .avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; }
  .body { flex: 1; min-width: 0; }
  .head { display: flex; gap: 4px; }
  .muted { color: var(--muted); }
  .head { align-items: center; height: 20px; }
  .top-right { display: flex; margin-left: auto; gap: 4px; }
  .top-right button { padding: 0; border: 0; background: none; cursor: pointer; }
  a { color: inherit; text-decoration: none; }
  [data-testid="tweetText"] { white-space: pre-wrap; }
  article [role="group"][aria-label="actions"] { display: flex; justify-content: space-between; max-width: 425px; margin-top: 8px; }
  .cell { position: relative; display: flex; flex: 1 1 0; }
  .cell:nth-last-child(-n+2) { flex: none; }
  .cell:nth-last-child(2) { margin-left: auto; margin-right: 8px; }
  .cell button { padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; }
  .icon { display: flex; align-items: center; gap: 4px; color: var(--muted); font-size: 13px; }
  .icon svg { width: 18.75px; height: 18.75px; padding: 8px; margin: -8px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
`;

export function xHomePage(tweets, theme = "dark") {
  return page("X", theme, X_STYLES, tweets.map(xTweet).join(""));
}

// -- Reddit --

const REDDIT_POST_SHADOW = `<template shadowrootmode="open"><style>
  :host { display: block; position: relative; padding: 8px 16px; border-radius: 16px; }
  :host(:hover) { background: var(--hover); }
  .credit { font-size: 12px; color: var(--muted); }
  .title { display: block; margin: 4px 0; font-size: 18px; font-weight: 600; line-height: 24px; }
  .actions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 999px; background: var(--pill); font-size: 12px; font-weight: 600; }
  .push { margin-left: auto; }
</style>
<slot name="full-post-link"></slot>
<div class="credit"><slot name="credit-bar"></slot></div>
<div class="title"><slot name="title"></slot></div>
<slot name="text-body"></slot>
<div class="actions"><span class="pill">&#8679; 1.2k &#8681;</span><span class="pill">&#128172; 84</span><span class="pill">Share</span><div class="push"></div><slot name="action-row-whitespace"></slot></div>
</template>`;

const REDDIT_COMMENT_SHADOW = `<template shadowrootmode="open"><style>
  :host { display: block; margin-top: 12px; }
  .meta { font-size: 12px; color: var(--muted); }
  .children { margin-left: 22px; padding-left: 12px; border-left: 1px solid var(--line); }
</style>
<div class="meta"><slot name="commentMeta"></slot></div>
<slot name="comment"></slot>
<slot name="actionRow"></slot>
<div class="children"><slot name="children"></slot></div>
</template>`;

const REDDIT_ACTION_ROW_SHADOW = `<template shadowrootmode="open"><style>
  .row { display: flex; align-items: center; gap: 4px; height: 32px; font-size: 12px; font-weight: 600; color: var(--muted); }
  ::slotted(button) { height: 32px; padding: 0 10px; border: 0; border-radius: 999px; background: none; color: inherit; font: inherit; }
</style>
<div class="row"><span>&#8679; 12 &#8681;</span><slot name="comment-reply"></slot><slot name="comment-share"></slot><slot name="comment-insight"></slot><slot name="overflow"></slot></div>
</template>`;

// post = { id, community, author, title, body }
function redditPost(post) {
  return `<article><shreddit-post id="${post.id}" permalink="/${post.community}/comments/${post.id.slice(3)}/a_post/" post-title="${escapeHtml(post.title)}" author="${post.author}" subreddit-prefixed-name="${post.community}" post-type="text">${REDDIT_POST_SHADOW}
  <a slot="full-post-link" href="/${post.community}/comments/${post.id.slice(3)}/a_post/" style="position:absolute;inset:0"></a>
  <span slot="credit-bar">${post.community} · 5 hr. ago</span>
  <a slot="title" href="/${post.community}/comments/${post.id.slice(3)}/a_post/">${escapeHtml(post.title)}</a>
  <div slot="text-body"><p>${escapeHtml(post.body)}</p></div>
</shreddit-post></article><hr>`;
}

// comment = { id, author, text, replies: [comment] }
function redditComment(comment, postId) {
  const replies = (comment.replies ?? []).map((reply) => redditComment(reply, postId).replace("<shreddit-comment ", '<shreddit-comment slot="children" '));
  return `<shreddit-comment thingid="${comment.id}" postid="${postId}" permalink="/r/AskReddit/comments/${postId.slice(3)}/comment/${comment.id.slice(3)}/" author="${comment.author}">${REDDIT_COMMENT_SHADOW}
  <div slot="commentMeta">${comment.author} · 3h</div>
  <div slot="comment" id="${comment.id}-comment-rtjson-content"><p>${escapeHtml(comment.text)}</p></div>
  <div slot="actionRow"><shreddit-comment-action-row comment-id="${comment.id}">${REDDIT_ACTION_ROW_SHADOW}<button slot="comment-reply">Reply</button><button slot="comment-share">Share</button><button slot="overflow">···</button></shreddit-comment-action-row></div>
  ${replies.join("")}
</shreddit-comment>`;
}

const REDDIT_STYLES = `
  html { --background: #fff; --text: #1a1a1b; --muted: #576f76; --pill: #e5ebee; --hover: #f6f8f9; --line: #e5ebee;
         --color-neutral-content-weak: #576f76; --color-button-secondary-background: #e5ebee; }
  html[data-theme="dark"] { --background: #0e1113; --text: #d7dadc; --muted: #8ba2ad; --pill: #2a3236; --hover: #131f23; --line: #2a3236;
         --color-neutral-content-weak: #8ba2ad; --color-button-secondary-background: #2a3236; }
  body { margin: 0; background: var(--background); color: var(--text); font: 14px/21px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  #feed { width: 740px; margin: 0 auto; padding: 16px 0; }
  article { margin: 0; }
  hr { margin: 4px 16px; border: 0; border-top: 1px solid var(--line); }
  p { margin: 4px 0; }
  a { color: inherit; text-decoration: none; }
  .comments { padding: 0 16px; }
`;

export function redditPage(posts, comments, theme = "light") {
  let feedHtml = posts.map(redditPost).join("");
  if (comments.length > 0) {
    feedHtml = feedHtml + `<div class="comments">${comments.map((comment) => redditComment(comment, posts[0].id)).join("")}</div>`;
  }
  return page("Reddit", theme, REDDIT_STYLES, feedHtml);
}

// -- YouTube --

// video = { id, title, channel, colors: [two CSS colours for the stand-in thumbnail] }
function youTubeTile(video) {
  return `<ytd-rich-item-renderer><yt-lockup-view-model class="lockup">
  <div class="ytLockupViewModelHost">
    <a href="/watch?v=${video.id}" class="thumbnail" style="background:linear-gradient(135deg, ${video.colors[0]}, ${video.colors[1]})"><span class="duration">12:48</span></a>
    <div class="ytLockupViewModelMetadata"><yt-lockup-metadata-view-model class="metadata">
      <div class="avatar" aria-label="Go to channel ${escapeHtml(video.channel)}" role="button" style="background:${video.colors[1]}"></div>
      <div class="text">
        <h3><a href="/watch?v=${video.id}" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</a></h3>
        <div class="ytContentMetadataViewModelMetadataText">${escapeHtml(video.channel)}</div>
        <div class="muted">287K views · 3 months ago</div>
      </div>
      <div class="ytLockupMetadataViewModelMenuButton"><button-view-model><button aria-label="More actions" class="menu">&#8942;</button></button-view-model></div>
    </yt-lockup-metadata-view-model></div>
  </div>
</yt-lockup-view-model></ytd-rich-item-renderer>`;
}

const YOUTUBE_STYLES = `
  html { --yt-sys-color-baseline--text-primary: #0f0f0f; --muted: #606060; --background: #fff; }
  html[dark] { --yt-sys-color-baseline--text-primary: #f1f1f1; --muted: #aaa; --background: #0f0f0f; }
  body { margin: 0; background: var(--background); color: var(--yt-sys-color-baseline--text-primary); font: 14px/20px Roboto, Arial, sans-serif; }
  #feed { display: grid; grid-template-columns: repeat(3, 360px); gap: 40px 16px; padding: 24px; }
  ytd-rich-item-renderer, yt-lockup-view-model { display: block; }
  .thumbnail { position: relative; display: block; aspect-ratio: 16 / 9; border-radius: 12px; }
  .duration { position: absolute; right: 8px; bottom: 8px; padding: 1px 4px; border-radius: 4px; background: rgba(0,0,0,.6); color: #fff; font-size: 12px; }
  .metadata { display: flex; gap: 12px; margin-top: 12px; }
  .avatar { flex: none; width: 36px; height: 36px; border-radius: 50%; }
  .text { flex: 1; min-width: 0; }
  h3 { margin: 0 0 4px; font-size: 16px; line-height: 22px; font-weight: 500; }
  a { color: inherit; text-decoration: none; }
  .muted, .ytContentMetadataViewModelMetadataText { color: var(--muted); }
  .ytLockupMetadataViewModelMenuButton { flex: none; }
  .menu { width: 40px; height: 40px; border: 0; border-radius: 50%; background: none; color: inherit; font-size: 20px; opacity: 0; }
  yt-lockup-view-model:hover .menu { opacity: 1; }
`;

export function youTubeHomePage(videos, theme = "light") {
  return page("YouTube", theme, YOUTUBE_STYLES, videos.map(youTubeTile).join(""));
}

// Serves pages[url] for each address given, and an empty 404 for anything else on those sites.
export async function serveStandInPages(context, pages) {
  for (const origin of ["https://x.com", "https://www.reddit.com", "https://www.youtube.com"]) {
    await context.route(origin + "/**", async (route) => {
      const html = pages[route.request().url()];
      if (html === undefined) {
        await route.fulfill({ status: 404, body: "" });
        return;
      }
      await route.fulfill({ contentType: "text/html", body: html });
    });
  }
}

// -- Sample feeds --

// One feed per site with a post the mock server shows, hides and blurs, and on Reddit a comment
// thread. The ids are found once, so the tests and the screenshots name the same posts.
export const SAMPLE_X_TWEETS = [
  { id: postIdFor("1851000000", "allow"), name: "Mara Lin", handle: "maralin", avatar: "#c08457",
    text: "Finally got the sourdough starter to double in six hours. The trick was moving it to the top of the fridge, where it is warm." },
  { id: postIdFor("1852000000", "hide"), name: "Daily Vibes", handle: "dailyvibes", avatar: "#7c3aed",
    text: "Like this if you remember 2009. Repost if you are still here. Most people will scroll past this." },
  { id: postIdFor("1853000000", "blur"), name: "The Real Story", handle: "realstory", avatar: "#dc2626",
    text: "Nobody is talking about this and it should make every one of you furious. Read the whole thread before they delete it." },
  { id: "promoted", promoted: true, name: "Deskworks", handle: "deskworks", avatar: "#0891b2",
    text: "Upgrade your workspace with our new standing desk." },
  { id: postIdFor("1855000000", "allow"), name: "Sam Okafor", handle: "samokafor", avatar: "#16a34a",
    text: "Wrote up how we cut CI from 14 minutes to 3: caching, test sharding, and deleting the tests nobody had run in a year." },
];

export const SAMPLE_REDDIT_POSTS = [
  { id: postIdFor("t3_bread", "allow"), community: "r/Breadit", author: "crumbshot",
    title: "First open crumb after a year of trying", body: "75% hydration, cold retard overnight, baked in a Dutch oven at 250 C. Happy to share the schedule." },
  { id: postIdFor("t3_aita", "allow"), community: "r/AmItheAsshole", author: "throwaway_9921",
    title: "AITA for not inviting my sister to my birthday after she said I always make everything about me?", body: "Upvote if you agree, comment if you don't. You won't believe what she said next." },
  { id: postIdFor("t3_rant", "blur"), community: "r/rant", author: "fedup_again",
    title: "Everyone in this city is the worst and I am done pretending otherwise", body: "Every single person I met today was rude. This place is broken and so are the people in it." },
];

export const SAMPLE_REDDIT_COMMENTS = [
  { id: postIdFor("t1_crumbtip", "allow"), author: "levain_lab",
    text: "Great oven spring. If you want a more even crumb, try one more set of folds in the first hour.",
    replies: [
      { id: postIdFor("t1_crumbreply", "allow"), author: "crumbshot", text: "Thanks, will try that this weekend. Did you shape on a wet or floured bench?" },
    ] },
  { id: postIdFor("t1_crumbmean", "hide"), author: "anon_4410", text: "lol nobody asked" },
];

export const SAMPLE_YOUTUBE_VIDEOS = [
  { id: postIdFor("knownbake", "allow"), title: "How to make sourdough bread: the full process, start to finish", channel: "Preppy Kitchen", colors: ["#e7c9a0", "#8a5a2b"] },
  { id: postIdFor("knownshock", "hide"), title: "You WON'T BELIEVE what happens at 0:47 (insane)", channel: "Clip Storm", colors: ["#ff3d00", "#ffd600"] },
  { id: postIdFor("knownlect", "allow"), title: "Lecture 4: Dynamic programming, explained with examples", channel: "Open Course", colors: ["#1e3a8a", "#60a5fa"] },
  { id: postIdFor("knownrage", "blur"), title: "This city council meeting will make you lose faith in humanity", channel: "Outrage Daily", colors: ["#450a0a", "#ef4444"] },
  { id: postIdFor("knownwood", "allow"), title: "Building a walnut side table with hand tools only", channel: "Quiet Workshop", colors: ["#3f2a1d", "#b08968"] },
  { id: postIdFor("knownhike", "allow"), title: "Three days on the Lost Coast Trail", channel: "Trail Notes", colors: ["#14532d", "#86efac"] },
];

export const STAND_IN_URLS = {
  x: "https://x.com/home",
  reddit: "https://www.reddit.com/r/Breadit/comments/standin/a_post/",
  youtube: "https://www.youtube.com/",
};

export function samplePages(theme = {}) {
  return {
    [STAND_IN_URLS.x]: xHomePage(SAMPLE_X_TWEETS, theme.x ?? "dark"),
    [STAND_IN_URLS.reddit]: redditPage(SAMPLE_REDDIT_POSTS, SAMPLE_REDDIT_COMMENTS, theme.reddit ?? "light"),
    [STAND_IN_URLS.youtube]: youTubeHomePage(SAMPLE_YOUTUBE_VIDEOS, theme.youtube ?? "light"),
  };
}
