# BrainRot Index browser extension

Watches your Reddit, X and YouTube feeds, asks the BrainRot Index server about each post, reply and
video, and blurs or hides the ones your plugins flag. All decisions are made on the server; the extension only shows
them.

## Install in Brave (or Chrome)

People outside the project install the packed zip from https://brainrotindex.com/install, which
walks through unzipping it and Load unpacked. `node scripts/package-extension.mjs` makes that zip
(`dist/brainrot-index-extension-<version>.zip`, the file for the Chrome Web Store too); the site's
image builds it the same way. The packed manifest grants only `https://brainrotindex.com`; pass
`--all-addresses` to keep the development addresses. The version comes from `manifest.json` and is
only ever changed by hand. The Web Store listing is described in `docs/webstore/README.md`.

To work on the extension from a checkout:

1. In `extension-tests/`, run `npm install` once, then `node stamp-build-info.mjs`. This writes
   `extension/build-info.json` so feedback you send names the exact code version. Run it again after
   pulling new code. Without it the version shows as "unstamped".
2. Open `brave://extensions` (or `chrome://extensions`) and turn on Developer mode.
3. Click Load unpacked and choose this folder: `brainrot-index/extension`.
4. After pulling new code, press the reload arrow on the extension's card.

The server address defaults to `https://brainrot.jacob-waters.com`. It can be changed on the
extension's options page (right-click the toolbar icon, Options).

## Connect it to your account

Sign in at https://brainrot.jacob-waters.com, open the dashboard and press Connect extension. The
page says Connected and the extension's popup says "Connected to your account". A website tab that
was already open when the extension was installed or reloaded is given the connect listener then,
so reloading it is not needed. If the dashboard still says the extension did not answer, reload the
dashboard tab and press Connect extension again.

## Using it

- Flagged posts are blurred, with a small label over the post's corner, or collapsed to one quiet
  line. Either reads what was done and which plugin, for example "Hidden · Engagement bait".
  Hovering the line, or the blurred post, adds the plugin's label and score ("Asks for engagement ·
  90/100") and the buttons: **Show** and the thumbs.
- **Show** (or a click anywhere on a blurred post) reveals the post where it is; the line above it
  then offers **Blur again** or **Hide again**. A revealed post stays revealed while the page is
  open, also after scrolling away and back. In child mode there is no Show.
- While the server is still deciding about a post it is shown normally, or blurred in child mode.
  The extension keeps asking for up to 2 minutes while the post is on the page, then leaves it shown.
- A post whose "hide" answer arrives while it is on screen (or already scrolled past) is blurred
  instead, so the page never jumps under you. It is collapsed the next time the site redraws it.
- On Reddit, a hidden comment shows only its author line and the one-line notice; its replies stay
  visible.
- On YouTube, video tiles on the home page, in search results, in the "up next" column of a watch page
  and in Shorts shelves are filtered; playlists, mixes and ads are not. A hidden tile keeps its place
  in the grid with only the one-line notice in it. The server judges a video by its title, thumbnail
  and transcript. Hovering a blurred tile does not play its preview. On a narrow Shorts tile the
  label wraps so the plugin and score stay readable, and hovering any label shows all of it.
- The transcript comes from your browser: for a video the server has never classified, it asks for
  the transcript, and the extension fetches the video's captions from YouTube (English if there are
  any, captions written by a person before automatic ones) and sends the first 2500 words with the
  video. Videos the server already knows cost no request to YouTube. At most two videos are fetched
  at once and 20 a minute, each given up after 2.5 seconds; once YouTube refuses a request, no more
  are made until the browser restarts. See `sites/youtube-transcript.js`.

## Reporting mistakes

- **Thumbs up or down** on any post the server answered for saves the reader's verdict at once. On a
  blurred or hidden post they are on its label; on a post that was shown they appear on hover where
  the site keeps its own post actions: on X just before a tweet's "More" menu, on Reddit at the end
  of a post's row of actions and between Share and "..." on a comment, on YouTube under a tile's
  "More actions" button. Thumbs down on a shown post means a filter should have caught it.
- After the click a small box offers, optionally, a severity (Low, Medium, High), details, and for a
  shown post that should have been caught, which filter. Save sends them; the box leaves by itself
  after a few seconds when it is not touched. Each verdict is stored on the server as a labeled
  example (`PostJudgment`) with what every filter decided about the post, for evaluating filters.
- **Right-click a post, "BrainRot Index: report this post"**: the same form over a post the extension
  left alone, with Hidden chosen. Use the text box to name a new kind of post to filter. Outside a
  post it reports the page as one that should have been filtered.
- **Popup text box**: free-text feedback, sent with the address of the tab you are on. If it cannot
  be sent the popup says why (for example, not connected).

Every report carries the extension's code version, shown at the bottom of the popup.

## Popup

Shows whether the extension is connected, an on/off switch, how many posts were checked and how many
were blurred or hidden in this browser session, the feedback box, and a link to the site.

## Tests

See `extension-tests/README.md`. In short, from `extension-tests/`:

    npm test                      # against a built-in mock server
    BRAINROT_SERVER=https://brainrot.jacob-waters.com BRAINROT_TOKEN=<token> npm test
