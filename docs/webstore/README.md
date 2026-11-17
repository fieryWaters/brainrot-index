# Chrome Web Store submission kit

Everything the Chrome Web Store Developer Dashboard asks for, written to match what the extension
really does (checked against the code on 2026-11-16). Copy each block into the field of the same
name. Brave installs extensions from the Chrome Web Store, so one listing covers both browsers.

Requirements were checked on 2026-11-16 against Google's pages:
[images](https://developer.chrome.com/docs/webstore/images),
[listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing),
[privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
[best practices](https://developer.chrome.com/docs/webstore/best-listing),
[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use).
The dashboard's own wording wins where it differs from this file.

## Steps for the owner

1. Register a developer account at https://chrome.google.com/webstore/devconsole with the Google
   account that should own the listing. Google charges a one-time registration fee (it has long been
   US $5; the dashboard shows the current amount). Use a contact email that is read, such as
   support@brainrotindex.com, and verify it.
2. Verify brainrotindex.com in Google Search Console with the same Google account, so it can be
   chosen as the listing's Official URL.
3. Build the zip from a clean, committed checkout:
   `node scripts/package-extension.mjs` writes `dist/brainrot-index-extension-<version>.zip`.
   The zip grants only `https://brainrotindex.com`; the development addresses are left out.
4. Dashboard: **Items, New item**, upload the zip.
5. Fill in **Store listing**, **Privacy practices** and **Distribution** from the sections below,
   and upload the images listed under Images.
6. Submit for review. Review usually takes from a day to a few weeks.
7. When the listing is live, put its address in `.env` as `WEBSTORE_URL=` and redeploy. The site's
   install page then shows one "Add to Brave or Chrome" button instead of the manual steps.
8. Every later upload needs a higher `version` in `extension/manifest.json`; bump it by hand in the
   commit that changes the extension, then package again.

## Store listing

**Title** (from the manifest name)

    BrainRot Index

**Summary** (132 characters at most; this is the manifest description)

    BrainRot Index - The algorithm that works for you

**Description**

    BrainRot Index - The algorithm that works for you.

    Your feeds are tuned to keep you scrolling. BrainRot Index is tuned by you. It works on X,
    Reddit and YouTube.

    As you scroll, the extension checks each post, reply and video with AI and blurs or hides the
    ones your filters flag. Each hidden post leaves a one-line label saying why, for example
    "Hidden - Ragebait: Blames a group (91/100)", and one click shows it.

    Four filters are built in:
    - Engagement bait: posts made to farm replies, likes and shares.
    - Ragebait: posts built to make you angry, such as blaming whole groups of people.
    - Brainrot: attention sinks with nothing inside, such as meme-slang loops.
    - AI slop: mass-produced generated content and reply-guy promotion.

    On your dashboard at brainrotindex.com you choose which filters run, how strict each one is,
    and whether flagged posts are blurred or hidden. Child mode keeps posts blurred until they have
    been checked and does not let filtered posts be revealed.

    Report a mistake with the "Wrong?" link on any label, or right-click any post.

    How to start:
    1. Create an account at brainrotindex.com. The first 7 days are free and need no card.
    2. Install this extension.
    3. Open your dashboard and press Connect extension.

    BrainRot Index costs $5 a month after the free trial.

    Privacy: while it is switched on, the extension sends the posts and videos it checks on X, Reddit
    and YouTube to the BrainRot Index server, where AI models classify them. For a YouTube video it
    reads the video's captions in your browser and sends them with the video. Posts and videos are
    stored together with the account that sent them and used to run the service, improve the filters
    and prevent abuse. The extension does not read your messages, what you type, or any other site.
    We do not sell your data or use it for advertising. Full details: https://brainrotindex.com/privacy

**Category**: Social Media & Networking (in the 2023 category list; pick the closest current name).

**Language**: English.

**Official URL**: https://brainrotindex.com (after step 2 above).
**Homepage URL**: https://brainrotindex.com
**Support URL**: mailto:support@brainrotindex.com, or https://brainrotindex.com/install

**Mature content**: No.

## Images

| Asset | Size | Required | Status |
| --- | --- | --- | --- |
| Store icon | 128 x 128 PNG, artwork 96 x 96 with 16 px transparent margin | yes | Done: `extension/icons/icon128.png`, inside the zip |
| Screenshots | 1280 x 800 (preferred) or 640 x 400, square corners, full bleed; 1 to 5 | at least 1 | To do, see below |
| Small promo tile | 440 x 280 | no, but listings without it rank lower | Done: `docs/webstore/promo-tile-440x280.png` |
| Marquee promo tile | 1400 x 560 | only for being featured | Not made |

The icon is the glowing blue shield with a line-art brain, on a transparent background; the promo
tile and the site's social preview put it on the logo's deep navy with a light cyan headline. All
brand images are drawn from `brand/logo-source.webp` by `node extension-tests/make-icons.mjs` (run
`npm install` in `extension-tests` first). The site's palette is defined once in
`frontend/brainrot-index-frontend/src/index.css`.

Screenshots to take at 1280 x 800 (a Brave window of that size, with a signed-in account; do not
show other people's identifiable posts prominently, or crop them):

1. A Reddit feed with one post blurred and its label showing, and one hidden post's one-line label.
2. An X feed with a hidden post's label and the Show and Wrong? buttons.
3. The dashboard: filters with their strictness sliders and Blur or Hide.
4. A YouTube home page with blurred video tiles and their labels.
5. The extension's popup over a feed, showing "Connected to your account" and the counts.
The landing page's before and after picture (https://brainrotindex.com, top of the page) can replace
any of these; five is the most the listing takes.

## Privacy practices

**Single purpose**

    BrainRot Index hides unwanted posts in social media feeds: it sends the posts and videos shown
    on X, Reddit and YouTube to the BrainRot Index server, which classifies them with the user's
    chosen filters, and blurs or hides the ones the server flags.

**Permission justifications** (one per entry in `manifest.json`)

| Permission | Justification |
| --- | --- |
| `storage` | Keeps the account connection key, the on/off switch and the server address, and remembers the server's answers for posts during the browser session so a post is not sent twice. |
| `contextMenus` | Adds "BrainRot Index: report this post" to the right-click menu on X, Reddit and YouTube, so the user can report a post or video the filters got wrong. |
| `activeTab` | When the user sends feedback from the toolbar popup, reads the address of the tab they are on to attach it to the report. |
| `scripting` | Right after install, adds the connect script to brainrotindex.com tabs that were already open, so the site's Connect extension button works without reloading the page. |
| Host permission `https://brainrotindex.com/*` | The extension's server: it sends posts there for classification, reads the user's settings, sends feedback, and receives the account connection key from the site's Connect extension button. |
| Content scripts on `https://www.reddit.com/*` and `https://x.com/*` | Read the posts and replies shown in the feed and in threads, and blur or hide the ones the server flags. |
| Content script on `https://www.youtube.com/*` | Reads the video tiles on the home page, in search results, beside a playing video and in Shorts shelves, and blurs or hides the ones the server flags. For a video the server has not seen before, it fetches that video's captions from www.youtube.com (without the user's YouTube cookies) and sends them with the video, so the filters can judge what is said in it. |

**Remote code**: No, I am not using remote code. (All JavaScript is in the package; the server
only returns JSON data.)

**Data usage**: tick these categories.

- **Website content**: yes. The text of every post and reply the extension sees on X and Reddit,
  its address, its community, and the addresses of its images; for every YouTube video tile, the
  video's id, title, channel name, description snippet (search results only) and thumbnail
  address, and for a video the server has not seen before, the first 2500 words of its captions,
  with their language and whether they are automatic. All of it is stored with the account that
  sent it. The server downloads and stores the images and thumbnails too.
- **Personally identifiable information**: yes. The account's email address, which the posts are
  stored with, and the usernames of post authors, which are sent with each post.
- **Authentication information**: yes. The extension stores and sends an account connection key.
- **User activity**: no. It does not record clicks, keystrokes or scrolling.
- **Web history**: yes. The server keeps, with the account, the addresses of the X and Reddit posts
  and YouTube videos the extension saw, and when each was first and last sent, which is a record of
  what the user scrolled past on those sites. The feedback
  form also attaches the address of the current tab when the user sends a report. It never sends
  the list of other pages visited.
- **Location, health, financial and payment, personal communications**: no. (Payments happen on the
  website through Stripe, not in the extension.)

**Certifications**: all three can be ticked truthfully, with the notes below.

- I do not sell or transfer user data to third parties, outside of the approved use cases.
  (Post content goes to the AI model providers OpenRouter and Google only to classify it; the other
  services that run the site, Stripe, Resend and Cloudflare, receive only what they need for that.
  Nothing is sold or used for advertising.)
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  (Stored posts are used to run the filtering, to improve the filters, mostly through automated and
  aggregate analysis and the posts users report with "Wrong?", and to detect and investigate abuse.)
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

How this meets Limited Use's rule on people reading user data: a person on our side reads an
individual stored post only when the user reports it (their consent), when investigating abuse or a
security problem, or when the law requires it. Those are the exceptions the policy allows. Other
work on the filters uses automated and aggregate analysis.

**Privacy policy URL**: https://brainrotindex.com/privacy

### Decisions the owner must make before submitting

- **People reading stored posts.** Decided: only reported posts, abuse or security investigations,
  and legal requirements, as the Privacy Policy now says. Keep the admin used that way; browsing
  stored posts for any other reason would break both the policy and Limited Use.
- **Posts stored with the account.** Built on 2026-11-17: every post and video a classify request
  carries is recorded with the account and extension connection that sent it (PostSubmission),
  included in the data export and deleted with the account.
- **"Data mining" the cache.** Using stored posts to improve the filters fits the single purpose.
  Any other use (research unrelated to filtering, selling datasets, training general models) would
  not, and would also contradict the Privacy Policy as written.
