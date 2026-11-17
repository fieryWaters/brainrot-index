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

    Brainrot Index

**Summary** (132 characters at most; this is the manifest description)

    Hides brainrot, ragebait and engagement bait in your X and Reddit feeds, using the filters you choose on brainrotindex.com.

**Description**

    Brainrot Index gives you a calmer feed on X and Reddit.

    As you scroll, the extension checks each post and reply with AI and blurs or hides the ones your
    filters flag. Each hidden post leaves a one-line label saying why, for example
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

    Brainrot Index costs $5 a month after the free trial.

    Privacy: while it is switched on, the extension sends each post it sees on X and Reddit (its
    text, author username, address and image addresses) to the Brainrot Index server, where AI models
    classify it. Posts are stored in a shared cache that does not record who saw them. The extension
    does not read your messages, what you type, or any other site. We do not sell data or show ads.
    Full details: https://brainrotindex.com/privacy

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

All brand images are drawn from `frontend/brainrot-index-frontend/public/favicon.svg` by
`node extension-tests/make-icons.mjs`.

Screenshots to take at 1280 x 800 (a Brave window of that size, with a signed-in account; do not
show other people's identifiable posts prominently, or crop them):

1. A Reddit feed with one post blurred and its label showing, and one hidden post's one-line label.
2. An X feed with a hidden post's label and the Show and Wrong? buttons.
3. The dashboard: filters with their strictness sliders and Blur or Hide.
4. The extension's popup over a feed, showing "Connected to your account" and the counts.
5. The landing page's before and after picture (https://brainrotindex.com, top of the page).

## Privacy practices

**Single purpose**

    Brainrot Index hides unwanted posts in social media feeds: it sends the posts shown on X and
    Reddit to the Brainrot Index server, which classifies them with the user's chosen filters, and
    blurs or hides the posts the server flags.

**Permission justifications** (one per entry in `manifest.json`)

| Permission | Justification |
| --- | --- |
| `storage` | Keeps the account connection key, the on/off switch and the server address, and remembers the server's answers for posts during the browser session so a post is not sent twice. |
| `contextMenus` | Adds "Brainrot Index: report this post" to the right-click menu on X and Reddit, so the user can report a post the filters got wrong. |
| `activeTab` | When the user sends feedback from the toolbar popup, reads the address of the tab they are on to attach it to the report. |
| `scripting` | Right after install, adds the connect script to brainrotindex.com tabs that were already open, so the site's Connect extension button works without reloading the page. |
| Host permission `https://brainrotindex.com/*` | The extension's server: it sends posts there for classification, reads the user's settings, sends feedback, and receives the account connection key from the site's Connect extension button. |
| Content scripts on `https://www.reddit.com/*` and `https://x.com/*` | Read the posts and replies shown in the feed and in threads, and blur or hide the ones the server flags. These are the two sites the extension filters. |

**Remote code**: No, I am not using remote code. (All JavaScript is in the package; the server
only returns JSON data.)

**Data usage**: tick these categories.

- **Website content**: yes. The text of every post and reply the extension sees on X and Reddit,
  its address, its community, and the addresses of its images. The server downloads and stores the
  images too.
- **Personally identifiable information**: yes. The usernames of post authors are sent with each
  post. The account's email address is held by the website (not collected by the extension itself;
  tick it to be safe).
- **Authentication information**: yes. The extension stores and sends an account connection key.
- **User activity**: no. It does not record clicks, keystrokes or scrolling.
- **Web history**: no. It sends only posts on X and Reddit, never the list of pages visited. (The
  feedback form attaches the address of the current tab when the user sends a report; if the
  reviewer counts that as web history, tick it.)
- **Location, health, financial and payment, personal communications**: no. (Payments happen on the
  website through Stripe, not in the extension.)

**Certifications**: all three can be ticked truthfully, with the note below.

- I do not sell or transfer user data to third parties, outside of the approved use cases.
  (Post content goes to the AI model providers OpenRouter and Google only to classify it.)
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**: https://brainrotindex.com/privacy

### Decisions the owner must make before submitting

- **People reading stored posts.** Limited Use generally forbids humans reading user data, except
  with the user's consent, for security, to comply with law, or when the data is aggregated and
  anonymized. The Privacy Policy says staff may read stored posts and reports to improve the
  filters. Reports a user sends are read with their consent; browsing stored posts in the admin is
  the grey area. Either keep that to posts named in reports, or ask a lawyer whether stored posts
  (public content not linked to an account) count.
- **"Data mining" the cache.** Using stored posts to improve the filters fits the single purpose.
  Any other use (research unrelated to filtering, selling datasets, training general models) would
  not, and would also contradict the Privacy Policy as written.
