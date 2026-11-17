# Chrome Web Store submission kit

Everything the Chrome Web Store Developer Dashboard asks for, checked against the code on
2026-11-17 (`extension/manifest.json`, `background.js`, `content/`, `sites/`, `popup/`, `options/`)
and against the live Privacy Policy at https://brainrotindex.com/privacy. Copy each block into the
field of the same name. Brave installs extensions from the Chrome Web Store, so one listing covers
both browsers.

Google's pages for these fields:
[images](https://developer.chrome.com/docs/webstore/images),
[listing](https://developer.chrome.com/docs/webstore/cws-dashboard-listing),
[privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
[distribution](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution),
[test instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions),
[Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use).
The dashboard's own wording wins where it differs from this file.

## What is in this folder

| File | Use |
| --- | --- |
| `screenshot-1-1280x800.png` to `screenshot-5-1280x800.png` | The five screenshots, in this order |
| `promo-tile-440x280.png` | Small promo tile |
| `../../extension/icons/icon128.png` | Store icon (also inside the zip) |

The zip is not committed (`dist/` is ignored). Build it from a clean checkout of the commit being
submitted: `node scripts/package-extension.mjs` writes `dist/brainrot-index-extension-1.0.0.zip`.
Upload that zip, never a zip of the `extension/` folder made by hand: the script takes the
development addresses (localhost, 127.0.0.1, brainrot.jacob-waters.com) out of the manifest, so the
published copy asks for access to https://brainrotindex.com only.

The screenshots are redrawn by `node extension-tests/screenshot-webstore.mjs` and the promo tile by
`node extension-tests/make-icons.mjs`. The screenshots show the real extension on stand-in pages with
made-up posts, which each picture says in a footnote.

## Steps for the owner

1. **Register.** Open https://chrome.google.com/webstore/devconsole and sign in with the Google
   account that should own the listing. That account needs 2-Step Verification turned on. Accept the
   developer agreement and pay the one-time registration fee (US $5 when last checked; the page
   shows the current amount).
2. **Account tab.** Set the publisher name (`BrainRot Index`) and a contact email that is read, such
   as support@brainrotindex.com, and verify it from the email Google sends. Declare **trader**
   status: BrainRot Index is sold for $5 a month, so it is a trader under EU law, and Google then
   asks for an address and phone number that it shows to people in the EU.
3. **Optional: verify the domain.** Verify brainrotindex.com in Google Search Console with the same
   Google account. It can then be chosen as the listing's Official URL and shows as verified.
4. **Make a reviewer account.** The extension does nothing without a signed-in, paid or trial
   account, and the trial may run out while the review waits. On the server:
   sign up `webstore-review@brainrotindex.com` (or any address you control) on the site, then
   `docker compose exec backend python manage.py mark_email_verified webstore-review@brainrotindex.com`
   and `docker compose exec backend python manage.py grant_comp webstore-review@brainrotindex.com`.
   Keep the password for the Test instructions field, in `docs/webstore/reviewer-account.local.txt`
   (git-ignored) if it is kept in the checkout.
5. **Build the zip** (see above) from the commit being submitted.
6. **New item.** In the dashboard press **New item** and upload the zip.
7. **Fill in the tabs** from the sections below: **Store listing** (text and images), **Privacy**,
   **Distribution**, **Test instructions**.
8. **Distribution: choose Unlisted** for the first submission. An unlisted item passes the same
   review but is reachable only by its link, so it can be installed and checked from the store before
   anyone finds it. Leave all regions on. If the dashboard asks about payments or in-app purchases,
   answer that the extension is free to install and the subscription is sold on the website, not
   through the store.
9. **Submit for review.** Leave "publish automatically after approval" on or off as you like.
   Review usually takes from a day to a few weeks; extensions that read site content take longer.
10. **After approval.** Install it from the unlisted link in a fresh Brave profile, sign in, press
    Connect extension on the dashboard and check that a feed is filtered. Then switch Distribution to
    **Public** (a change of visibility for the same package; if the dashboard sends it to review
    again, it is the package already approved). To make the site
    offer the store button, put the listing's address in `.env` as `WEBSTORE_URL=` and redeploy.
11. **Every later upload** needs a higher `version` in `extension/manifest.json`; bump it in the
    commit that changes the extension, then build the zip again.

## Store listing

**Title** (comes from the manifest name; cannot be typed in the dashboard)

    BrainRot Index

**Summary** (comes from the manifest description, 132 characters at most)

    BrainRot Index - The algorithm that works for you

**Description**

    The algorithm that works for you.

    Your feeds are tuned to keep you scrolling. BrainRot Index is tuned by you. It reads your social feeds with AI as you scroll and clears out the ragebait, engagement bait and brainrot before you reach it. You choose what goes.

    HOW IT WORKS
    As posts, replies and videos come onto your screen, the extension sends them to the BrainRot Index service, where AI filters score each one with its text and images. Posts your filters flag are blurred, or folded into a single line that says which filter caught them. One click shows any of them.

    FILTERS YOU CONTROL
    Four filters are built in:
    - Engagement bait: posts made to farm replies, likes and shares.
    - Ragebait: posts built to make you angry, such as blaming whole groups of people.
    - Brainrot: attention sinks with nothing inside.
    - AI slop: mass-produced generated content and reply-guy promotion.
    On your dashboard you turn each filter on or off, set how strict it is, and choose whether flagged posts are blurred or hidden. The plugin store has more filters, written by other people. Child mode keeps posts blurred until they have been checked and does not let filtered posts be revealed.

    TEACH IT
    Thumbs up or down on any post tells the filters whether they got it right. Right-click a post to report one they missed. The toolbar button turns filtering off and on and shows how many posts were checked.

    GETTING STARTED
    1. Create an account at brainrotindex.com. The first 7 days are free and need no card.
    2. Add this extension.
    3. Open your dashboard and press Connect extension.
    An account is required. After the free trial BrainRot Index costs $5 a month, paid on the website.

    WHERE IT WORKS
    X, Reddit and YouTube, in Chrome, Brave and other Chromium browsers on a computer.

    PRIVACY
    While filtering is on, the extension sends the posts and videos it checks on those sites to the BrainRot Index service: their text, links, author names and image addresses. They are stored with your account to run and improve the filters and to prevent abuse. The extension does not read your messages, what you type, or any other site. We do not sell your data or use it for advertising. Details: https://brainrotindex.com/privacy

The one line naming the supported sites is kept on purpose: the install prompt names them anyway,
and a listing that hides where the extension works invites a "misleading description" rejection.
It is the only place they are named.

**Category**: Lifestyle, Well-being. (Second choice: Social Networking.)

**Language**: English.

**Official URL**: https://brainrotindex.com (only after step 3; otherwise leave it unset).
**Homepage URL**: https://brainrotindex.com
**Support URL**: https://brainrotindex.com/install (or mailto:support@brainrotindex.com)

**Mature content**: No.

## Images

| Asset | Size | Required | File |
| --- | --- | --- | --- |
| Store icon | 128 x 128 PNG, artwork 96 x 96 with 16 px transparent margin | yes | `extension/icons/icon128.png` (inside the zip) |
| Screenshots | 1280 x 800, square corners, full bleed; 1 to 5 | at least 1 | `screenshot-1` to `screenshot-5`, upload in order |
| Small promo tile | 440 x 280 | no, but listings without it rank lower | `promo-tile-440x280.png` |
| Marquee promo tile | 1400 x 560 | only for being featured | not made |

What each screenshot shows:

1. "The algorithm that works for you": a dark feed with a hidden post's line (reason, Show, thumbs)
   and a blurred post.
2. "Every post and reply, checked as you scroll": a light thread with a blurred post, a hidden post
   and a hidden reply.
3. "Videos too": a dark video grid with one hidden and one blurred video.
4. "You choose what goes": the dashboard's My plugins card with strictness sliders and Blur or Hide.
5. "Tell it when it is wrong": the thumbs-down details box, and the toolbar popup.

## Privacy tab

**Single purpose**

    BrainRot Index filters unwanted posts out of social media feeds: it sends the posts and videos shown on supported sites to the BrainRot Index service, which scores them with the filters the user chose, and it blurs or hides the ones the service flags.

**Permission justifications** (one box per permission; the dashboard also asks about host access)

| Permission | Justification |
| --- | --- |
| `storage` | Keeps the account connection key, the on/off switch and the service address, and remembers the service's answers for posts during the browser session so a post is not sent twice. |
| `contextMenus` | Adds "BrainRot Index: report this post" to the right-click menu on the supported sites, so the user can report a post the filters missed or got wrong. |
| `activeTab` | When the user sends feedback from the toolbar popup, reads the address of the current tab to attach it to the report. |
| `scripting` | Right after install, adds the connect script to brainrotindex.com tabs that were already open, so the site's Connect extension button works without reloading the page. |
| Host permission `https://brainrotindex.com/*` | The extension's own service: it sends posts there to be scored, reads the user's filter settings, sends feedback, and receives the account connection key from the site's Connect extension button. |
| Content scripts on `https://x.com/*`, `https://www.reddit.com/*` | Read the posts and replies shown in the feed and in threads, and blur or hide the ones the service flags. |
| Content script on `https://www.youtube.com/*` | Reads the video tiles on the home page, in search results, beside a playing video and in Shorts shelves, and blurs or hides the ones the service flags. |

**Remote code**: "No, I am not using remote code." All JavaScript is in the package; the service only
returns JSON data.

**Data usage**: tick these.

- **Website content**: yes. For each post and reply on X and Reddit: its text, address, community,
  author's username and image addresses. For each YouTube video tile: the video id, title, channel
  name, description snippet (search results only) and thumbnail address. Stored with the account
  that sent them; the service also downloads and stores the images. Also the thumbs up or down,
  severity, filter and optional note the user gives a post.
- **Personally identifiable information**: yes. The usernames of post authors are sent with each
  post, and posts are stored with the account, which carries the user's email address.
- **Authentication information**: yes. The extension stores and sends an account connection key.
- **Web history**: yes. The service keeps, with the account, the addresses of the posts and videos
  the extension saw on the supported sites and when each was first and last sent, which is a record
  of what the user scrolled past there. Feedback sent from the popup carries the current tab's
  address. The list of other pages visited is never sent.
- **User activity**: no. Clicks, keystrokes, mouse movement and scrolling are not recorded.
- **Location, health, financial and payment, personal communications**: no. Payments happen on the
  website through Stripe, not in the extension.

**Certifications**: all three can be ticked truthfully.

- I do not sell or transfer user data to third parties, outside of the approved use cases.
  (Post content goes to the AI model provider, OpenRouter, which runs Google's Gemini model, only to
  score it; Stripe, Resend and Cloudflare receive only what they need to run the site. Nothing is
  sold or used for advertising.)
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  (Stored posts are used to run the filters, to improve them, and to detect and investigate abuse.)
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

People reading stored posts, under Limited Use: a person on our side reads an individual stored post
only when the user reports it (thumbs or report form), to investigate abuse or a security problem, or
when the law requires it, as the Privacy Policy says. Those are the cases the policy allows. Keep the
admin used that way.

**Privacy policy URL**: https://brainrotindex.com/privacy

## Test instructions tab

Fill in the reviewer account from step 4, and paste:

    BrainRot Index needs an account; this one is free and already verified.
    1. Install the extension, then sign in at https://brainrotindex.com/login with the account above.
    2. Open https://brainrotindex.com/dashboard and press "Connect extension". The toolbar popup then says "Connected to your account".
    3. Open https://www.reddit.com/r/popular/ or https://www.youtube.com/ (no sign-in needed). Within a few seconds posts the filters flag show a "Blurred" or "Hidden" label with the filter's name; "Show" reveals one.
    4. On the dashboard, under My plugins, move a filter's slider left to filter more posts, or switch it between Blur and Hide.

## Things a reviewer may question

Ordered from most to least likely to cause trouble.

1. **Reading and sending feed content.** Risk: medium. The whole product is sending what the user
   scrolls past to a server, which is the data Google's User Data policy watches most. It passes if
   the listing, the Privacy tab and the Privacy Policy agree, which they now do. There is no consent
   screen inside the extension itself; consent is the sign-up page's "By creating an account you
   agree to the Terms of Service and the Privacy Policy" line and the user pressing Connect
   extension. Google asks for in-product disclosure only when collection is not closely tied to the
   described purpose, which is not the case here, but a reviewer may still ask. If one does, a
   one-screen notice on the dashboard before Connect extension answers it.
2. **The extension needs an account to do anything.** Risk: medium if the Test instructions are
   empty, low with the reviewer account from step 4. Reviewers reject items they cannot try.
3. **Host access to three big sites.** Risk: low. The install prompt reads roughly "Read and change
   your data on brainrotindex.com, www.reddit.com, www.youtube.com and x.com". Named sites, not all
   sites, but any content-script access means a longer, partly manual review.
4. **Options page with a "Server address" box.** Risk: low. It lets anyone point the extension at
   another server. In the packed copy the host permission and the connect script cover only
   brainrotindex.com, so it is useful only for development, but a reviewer looking for ways data
   could go elsewhere may ask. Hiding the options page in the packed manifest would remove the
   question; not changed here.
5. **Site look-alikes in screenshots.** Risk: low. The screenshots use stand-in pages that look like
   the sites' feeds, with made-up posts and no site logos, and say so. Store policy forbids using
   other companies' logos or implying endorsement, which these do not.
6. **Child mode.** Risk: low. The listing mentions it, but neither the listing nor the site says the
   product is made for children, and the Privacy Policy says children under 13 may not have their own
   account. Do not tick anything that marks the item as designed for children.
7. **`activeTab` and `scripting`.** Risk: low. Each has one narrow use (above); reviewers mainly
   reject permissions that are never used, and both are used.

Already fine: no remote code, no `eval` or markup injection (everything is built element by
element), no obfuscation or minification, Manifest V3, no `<all_urls>`, no `tabs` or `webRequest`
permission.

## Elsewhere, not part of the submission

- The landing page and its questions still say "Wrong?", which the extension replaced with thumbs up
  and down.
- The site's social preview image (`frontend/brainrot-index-frontend/public/og-image.png`, drawn by
  `make-icons.mjs`) still spells "Brainrot Index" and names X and Reddit.
- The Privacy Policy source still carries a "draft, not yet reviewed" note for the owner (and ideally
  a lawyer) to check before relying on it.
