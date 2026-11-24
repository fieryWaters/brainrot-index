# Chrome Web Store submission kit

Everything the Chrome Web Store Developer Dashboard asks for, checked against the code on
2026-11-23 at extension version 0.1.0 (`extension/manifest.json`, `background.js`, `consent/`, `content/`,
`sites/`, `popup/`, `options/`, and the backend's `classification/` app) and against the live Privacy
Policy at https://brainrotindex.com/privacy. Copy each block into the
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
submitted: `node scripts/package-extension.mjs` writes `dist/brainrot-index-extension-0.1.0.zip`.
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
2. **Account tab.** Set the publisher name (`BrainRot Index`) and a contact email that is read, and
   verify it from the email Google sends. Declare **trader**
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
    commit that changes the extension (which number to raise is in `extension/README.md`, Version
    numbers), then build the zip again.

## Store listing

**Title** (comes from the manifest name; cannot be typed in the dashboard)

    BrainRot Index

**Summary** (comes from the manifest description, 132 characters at most)

    BrainRot Index - The algorithm that works for you

**Description**

    The algorithm that works for you.

    Your feeds are tuned to keep you scrolling. BrainRot Index is tuned by you. It reads your social feeds with AI as you scroll and clears out the brainrot, engagement bait and rude posts before you reach it. You choose what goes.

    HOW IT WORKS
    As posts, replies and videos come onto your screen, the extension sends them to the BrainRot Index service, where AI models rate each one from its text, images and video. Posts your filters flag are folded into a single line that says they were hidden; hover it to see which filter caught them and the ratings behind its score. One click shows any of them.

    FILTERS YOU CONTROL
    Four filters are built in:
    - Brainrot: attention sinks with nothing inside.
    - Engagement bait: posts made to farm replies, likes and shares.
    - Low Effort: inane, generic or mass-produced posts that give you nothing.
    - Rude or Toxic: posts written to insult, demean or pour contempt on people or groups.
    On your dashboard you turn each filter on or off and set how strict it is. The plugin store has more filters. Child mode keeps posts hidden until they have been checked and does not let filtered posts be revealed.

    TEACH IT
    Thumbs up or down on any post tells the filters whether they got it right, and you can pick which filter should have caught it. Right-click a post to report one they missed. The toolbar button turns filtering off and on and shows how many posts were checked.

    GETTING STARTED
    1. Create an account at brainrotindex.com. The first 7 days are free and need no card.
    2. Add this extension.
    3. Open your dashboard and press Connect extension.
    An account is required. After the free trial BrainRot Index costs $5 a month, paid on the website.

    PRIVACY
    Before it sends anything, the extension asks for your agreement. Once you agree, it sends the posts you see on supported sites (text, images, video, and who posted them) to the BrainRot Index service, which classifies them with AI models from our service providers. They are also used to improve the service and to detect fraud and abuse. We don't sell your data. Details: https://brainrotindex.com/privacy

**Category**: Lifestyle, Well-being. (Second choice: Social Networking.)

**Language**: English.

**Official URL**: https://brainrotindex.com (only after step 3; otherwise leave it unset).
**Homepage URL**: https://brainrotindex.com
**Support URL**: https://brainrotindex.com/install

**Mature content**: No.

## Images

| Asset | Size | Required | File |
| --- | --- | --- | --- |
| Store icon | 128 x 128 PNG, artwork 96 x 96 with 16 px transparent margin | yes | `extension/icons/icon128.png` (inside the zip) |
| Screenshots | 1280 x 800, square corners, full bleed; 1 to 5 | at least 1 | `screenshot-1` to `screenshot-5`, upload in order |
| Small promo tile | 440 x 280 | no, but listings without it rank lower | `promo-tile-440x280.png` |
| Marquee promo tile | 1400 x 560 | only for being featured | not made |

What each screenshot is meant to show:

1. "The algorithm that works for you": a dark feed with a hidden post's line (filter, ratings and
   score on hover, Show, thumbs).
2. "Every post and reply, checked as you scroll": a light thread with a hidden post and a hidden reply.
3. "Videos too": a dark video grid with hidden videos.
4. "You choose what goes": the dashboard's My plugins card with strictness sliders.
5. "Tell it when it is wrong": the thumbs box with its label picker, and the toolbar popup.

**All five committed pictures are out of date and must be redrawn before upload.** They were made
before version 0.1.0 and show things the extension no longer does:

- 1, 2, 3 and 5 show blurred posts ("Blurred · Ragebait"); there is no blur any more.
- 1 and 2 show the old hover text (a rubric label such as "Asks for engagement"); it now shows the
  feature ratings, such as "pull 8, emptiness 6.7".
- 1's caption says posts are "blurred or folded into one line"; 3's caption says videos are judged by
  "title, thumbnail and channel" (the video itself is now watched); 4's caption and picture show the
  Blur or Hide choice.
- 4 and 5 show Ragebait as a filter the user has by default; the defaults are now Brainrot,
  Engagement bait, Low Effort and Rude or Toxic.
- 5 shows the old details box (Filter, Severity), not the label picker ("Should be" / "Or blocked
  as"), and a popup with a "Disconnect and stop sending posts" link and a "Blurred or hidden" count,
  both since changed.

The consent screen is not among them: the store takes five screenshots at most, and the five above
show what the extension does. Reviewers see the consent screen when they install it (Test
instructions, step 1).

## Privacy tab

**Single purpose**

    BrainRot Index filters unwanted posts out of social media feeds: it sends the posts shown on supported sites to the BrainRot Index service, which classifies them with the user's filters, and hides the ones flagged.

**Permission justifications** (one box per permission; the dashboard also asks about host access)

| Permission | Justification |
| --- | --- |
| `storage` | Stores the user's settings, account connection and consent choice, and remembers results for posts already checked in this browser session. |
| `contextMenus` | Adds a right-click menu item on supported sites to report a post the filters missed. |
| `activeTab` | Attaches the current tab's address to feedback the user sends from the toolbar popup. |
| `scripting` | After install, adds the connect script to brainrotindex.com tabs that are already open. |
| Host permission `https://brainrotindex.com/*` | The extension's own service: sends posts to be classified, reads the user's filter settings, sends feedback and thumbs, and connects the account. |
| Content scripts on `https://x.com/*`, `https://www.reddit.com/*`, `https://www.youtube.com/*` | Read the posts shown in the feed and hide the ones flagged. |

**Remote code**: "No, I am not using remote code." All JavaScript is in the package; the service only
returns JSON data.

**Data usage**: tick these.

- **Website content**: yes. The posts and videos shown on supported sites (text, links, images,
  video, and who posted them), and the feedback and thumbs the user gives on a post.
- **Personally identifiable information**: yes. Post authors' usernames, and posts are stored with
  the user's account, which has their email address.
- **Authentication information**: yes. The account connection key.
- **Web history**: yes. The addresses of the posts and videos seen on supported sites, and the
  current tab's address on feedback sent from the popup.
- **User activity**: no.
- **Location, health, financial and payment, personal communications**: no.

**Certifications**: tick all three.

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

Not for the dashboard: Limited Use allows a person on our side to read an individual stored post only
with the user's consent (such as a post they thumb or report), for security or abuse, or when the law
requires it. Transfer to service providers is allowed when it serves the single purpose: post text
and images go to OpenRouter for Google Gemini models to rate, and a post's video goes to Google's
Gemini API to be watched (YouTube videos by their address; the opening seconds of Reddit and X
videos, which the server downloads). The Privacy Policy names these as "AI providers".

**Privacy policy URL**: https://brainrotindex.com/privacy

## Test instructions tab

Fill in the reviewer account from step 4 (`grant_comp` gives it permanent free access, so the
trial cannot run out during review), and paste this into the additional instructions box, which
takes 500 characters at most (this is 478). Reddit and YouTube work without signing in to
those sites, so the reviewer needs no account there; X does need one, so it is not mentioned.

    Account has permanent free access; no payment.
    1. Install. A BrainRot Index tab opens: press "Agree and continue". Nothing is sent before that.
    2. Sign in at https://brainrotindex.com/login, open /dashboard, press "Connect extension".
    3. Open https://www.reddit.com/r/popular/ or https://www.youtube.com/ (no sign-in needed). Flagged posts become a line reading "Hidden"; hovering it shows the filter and its score, and "Show" reveals the post.
    4. Toolbar button: on/off switch.

## Things a reviewer may question

Ordered from most to least likely to cause trouble.

1. **Reading and sending feed content.** Risk: medium. The whole product is sending what the user
   scrolls past to a server, which is the data Google's User Data policy watches most. It passes if
   the listing, the Privacy tab and the Privacy Policy agree, which they do on what is sent and why, and if the user
   agrees in the product first. The extension's consent screen (`extension/consent/`) opens on
   install and again on Connect extension, says in one paragraph what is sent and why, links the
   Privacy Policy, and has "Agree and continue" and "Not now". Nothing goes to the server before
   the user agrees; "Not now" leaves the extension doing nothing; turning the extension off or
   removing it stops it. The server records each agreement with the wording's version
   (`ExtensionDataConsent`), and a change of wording (`DATA_SHARING_DISCLOSURE_VERSION` in
   `background.js`) asks again. Keep the screen, the Privacy tab answers and the Privacy Policy in
   step when any of them changes.
2. **The extension needs an account to do anything.** Risk: medium if the Test instructions are
   empty, low with the reviewer account from step 4. Reviewers reject items they cannot try.
3. **Video sent to an AI provider.** Risk: low. Every post with a video, on any of the default
   filters, has its video watched by a Google Gemini model; for Reddit and X the server downloads
   and keeps the opening seconds. This is covered by "video" in the consent screen, the listing and
   the Privacy tab, and by "AI providers" in the Privacy Policy.
4. **Host access to three big sites.** Risk: low. The install prompt reads roughly "Read and change
   your data on brainrotindex.com, www.reddit.com, www.youtube.com and x.com". Named sites, not all
   sites, but any content-script access means a longer, partly manual review.
5. **Options page with a "Server address" box.** Risk: low. It lets anyone point the extension at
   another server. In the packed copy the host permission and the connect script cover only
   brainrotindex.com, so it is useful only for development, but a reviewer looking for ways data
   could go elsewhere may ask. Hiding the options page in the packed manifest would remove the
   question; not changed here. A code comment in the packed `background.js` also names the private
   development address, though the packed manifest grants no access to it.
6. **Site look-alikes in screenshots.** Risk: low. The screenshots use stand-in pages that look like
   the sites' feeds, with made-up posts and no site logos, and say so. Store policy forbids using
   other companies' logos or implying endorsement, which these do not.
7. **Child mode.** Risk: low. The listing mentions it, but neither the listing nor the site says the
   product is made for children, and the Privacy Policy says children under 13 may not have their own
   account. Do not tick anything that marks the item as designed for children.
8. **`activeTab` and `scripting`.** Risk: low. Each has one narrow use (above); reviewers mainly
   reject permissions that are never used, and both are used.

Already fine: no remote code, no `eval` or markup injection (everything is built element by
element), no obfuscation or minification, Manifest V3, no `<all_urls>`, no `tabs` or `webRequest`
permission.

## Elsewhere, not part of the submission

- The site's social preview image (`frontend/brainrot-index-frontend/public/og-image.png`, drawn by
  `make-icons.mjs`) still spells "Brainrot Index" and names X and Reddit.
- The Privacy Policy source still carries a "draft, not yet reviewed" note for the owner (and ideally
  a lawyer) to check before relying on it.
