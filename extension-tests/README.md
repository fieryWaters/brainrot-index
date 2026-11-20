# Extension tests

End-to-end tests for the browser extension in `../extension/`, run in headed Brave against live
Reddit, X and YouTube. Headed because Reddit and X block headless browsers; Brave because branded Google
Chrome ignores `--load-extension`.

## Setup

    cd extension-tests
    npm install

## Run against the mock server

    npm test              # all groups
    npm test -- connect   # connecting from a website tab opened before the extension was installed
    npm test -- reddit    # Reddit only: load, connect, feed, comments, feedback, reveal, performance
    npm test -- x         # X only: home feed, recycled tweets, feedback, reveal, replies, performance
    npm test -- youtube   # YouTube only: watch page, home, search, reveal, feedback, navigation, dark theme
    npm test -- transcripts  # the extension asks YouTube for no captions, on a stand-in for youtube.com (no real YouTube)
    npm test -- judgments    # thumbs and details box, on stand-ins for X, Reddit and YouTube (no real site)
    npm test -- consent      # consent screen: nothing sent before agreeing, Not now, Agree, Disconnect (no real site)
    npm test -- capture      # what is sent for tweets and Reddit posts saved from the real sites (no real site)

The connect group opens https://brainrot.jacob-waters.com without signing in, even with the mock
server, because the extension's default address is the only one it adds its listener to on install.

`npm test` first runs `stamp-build-info.mjs`, which writes `extension/build-info.json` (git-ignored)
with the short commit hash and whether the tree has uncommitted changes. The extension attaches that
value to every feedback report as `extension_commit`, and shows it at the bottom of the popup; without
the file it reports "unstamped". Run `node stamp-build-info.mjs` yourself after pulling new code if you
load the extension for daily use.

The runner starts `mock-server.mjs` on http://127.0.0.1:8787 and points the extension at it. The
mock follows the API contract with fixed rules (see the top of `mock-server.mjs`).

## Run against the real backend

    BRAINROT_SERVER=https://brainrot.jacob-waters.com BRAINROT_TOKEN=<extension token> npm test

The connect test is skipped (the real site needs a login), and the checks that depend on the mock's
rules (pending first, at least one blur and one hide) are printed instead of asserted. The feedback
tests send three real feedback reports (marked as automated in the popup text). The server
address must be one the manifest grants: `https://brainrot.jacob-waters.com`, `http://localhost`
or `http://127.0.0.1`.

To also exercise the real dashboard's Connect extension button and the settings checks (a plugin
threshold of 20 must filter more; child mode must blur pending posts and remove reveal), pass a
logged-in website session for the same account:

    BRAINROT_SERVER=... BRAINROT_TOKEN=... BRAINROT_SESSION_COOKIE=<sessionid> BRAINROT_CSRF_TOKEN=<csrftoken> npm test

Against a real server the runner prints, for each surface (Reddit feed, Reddit comments, X feed,
X replies, YouTube watch page, home and search): posts sent, how many were done on the first ask, the time from first send to done, the
flags by plugin, and a few flagged examples.

`BRAINROT_ONLY=4g npm test -- x` runs only the tests whose names start with "4g"; several prefixes
can be given separated by commas, for example `BRAINROT_ONLY=3a,6,8`.

## Run live with a fresh account (one command)

    node run-live-tests.mjs              # both groups
    node run-live-tests.mjs reddit       # or x
    node run-live-tests.mjs --probe-only # just check that real inference flags an obvious post

It signs up a new `e2e+<random>@brainrotindex.com` account with a random password, marks its address
verified over `ssh spark` (`manage.py mark_email_verified`), logs in, creates an extension token, sends
one obvious engagement-bait post and waits up to 60 seconds for it to be flagged, then runs the whole
suite against https://brainrot.jacob-waters.com with the real dashboard Connect button. No password or
token is printed or saved. It needs `ssh spark` to work from this Mac.

## Profiles

- Reddit tests use a new empty profile in `.profiles/` (git-ignored) on every run.
- YouTube tests also use a new empty profile, logged out. YouTube shows such a profile an empty home
  page until it has watched something, so the group starts by playing a video, muted, for 30 seconds.
  For each YouTube surface the runner prints the median time from a tile coming on screen to its
  answer being shown (to its label, for flagged videos).
- X tests use the signed-in profile `/Users/jacob/git-repos/brainrot-test-profile`. They are read
  only. If a Brave window already has that profile open, the X group is reported as failed rather
  than run.

Every browser a script opens is closed when the script ends or fails (`withBrave` in `browser.mjs`),
and any still open after an hour is closed by a timer.

## Other scripts

- `node screenshot-feedback-ui.mjs [folder]` photographs the hidden-post look and the thumbs on the
  stand-in pages (`stand-in-pages.mjs`), variant A (shipped) beside alternatives B and C, and writes
  comparison sheets to `docs/screenshots/feedback-hover-ui/`.
- `node screenshot-webstore.mjs [folder]` makes the five 1280 x 800 Chrome Web Store screenshots in
  `docs/webstore/`: the extension on the stand-in pages with the mock server, and the site's dashboard
  from its build (run `npx vite build` in `frontend/brainrot-index-frontend` first). Run
  `node stamp-build-info.mjs` on a clean, committed tree first, since the popup shows the commit.
- `node inspect-markup.mjs <url> [signed-in profile dir]` prints what a feed or thread page's markup
  looks like, for writing or fixing a site adapter.
- `node make-icons.mjs` redraws every PNG of the brand mark from the site's `favicon.svg`: the
  extension's icons, the site's apple-touch icon and social preview image, and the Web Store promo
  tile.
