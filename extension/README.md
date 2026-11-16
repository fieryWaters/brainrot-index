# Brainrot Index browser extension

Watches your Reddit and X feeds, asks the Brainrot Index server about each post and reply, and blurs
or hides the ones your plugins flag. All decisions are made on the server; the extension only shows
them.

## Install in Brave (or Chrome)

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

- Flagged posts are blurred, with a label over the post, or collapsed to one line. Either reads
  "Blurred" or "Hidden", then the plugin, its label and its score, for example
  "Hidden - Engagement bait: Asks for engagement (90/100)".
- **Show** on the label (or a click anywhere on a blurred post) reveals the post where it is; the
  line above it then offers **Blur again** or **Hide again**. A revealed post stays revealed while
  the page is open, also after scrolling away and back. In child mode there is no Show.
- While the server is still deciding about a post it is shown normally, or blurred in child mode.
  The extension keeps asking for up to 2 minutes while the post is on the page, then leaves it shown.
- A post whose "hide" answer arrives while it is on screen (or already scrolled past) is blurred
  instead, so the page never jumps under you. It is collapsed the next time the site redraws it.
- On Reddit, a hidden comment shows only its author line and the one-line notice; its replies stay
  visible.

## Reporting mistakes

- **Wrong?** on a blurred or hidden post's label opens a small form: pick what the post should have
  been (Shown is chosen), optionally say why, and press Send. The form says Recorded or the reason
  it could not send.
- **Right-click a post, "Brainrot Index: report this post"**: the same form over a post the extension
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
