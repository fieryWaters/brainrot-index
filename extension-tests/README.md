# Extension tests

End-to-end tests for the browser extension in `../extension/`, run in headed Brave against live
Reddit and X. Headed because Reddit and X block headless browsers; Brave because branded Google
Chrome ignores `--load-extension`.

## Setup

    cd extension-tests
    npm install

## Run against the mock server

    npm test              # both groups
    npm test -- reddit    # Reddit only: load, connect, feed, comments, performance
    npm test -- x         # X only: home feed, recycled tweets, feedback, replies, performance

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
X replies): posts sent, how many were done on the first ask, the time from first send to done, the
flags by plugin, and a few flagged examples.

`BRAINROT_ONLY=4g npm test -- x` runs only the tests whose names start with "4g".

## Run live with a fresh account (one command)

    node run-live-tests.mjs              # both groups
    node run-live-tests.mjs reddit       # or x
    node run-live-tests.mjs --probe-only # just check that real inference flags an obvious post

It signs up a new `e2e+<random>@brainrotindex.com` account with a random password, reads the
verification link from the backend log over `ssh spark`, logs in, creates an extension token, sends
one obvious engagement-bait post and waits up to 60 seconds for it to be flagged, then runs the whole
suite against https://brainrot.jacob-waters.com with the real dashboard Connect button. No password or
token is printed or saved. It needs `ssh spark` to work from this Mac.

## Profiles

- Reddit tests use a new empty profile in `.profiles/` (git-ignored) on every run.
- X tests use the signed-in profile `/Users/jacob/git-repos/brainrot-test-profile`. They are read
  only. If a Brave window already has that profile open, the X group is reported as failed rather
  than run.

## Other scripts

- `node inspect-markup.mjs <url> [signed-in profile dir]` prints what a feed or thread page's markup
  looks like, for writing or fixing a site adapter.
- `node make-icons.mjs` rewrites the extension's icon PNGs.
