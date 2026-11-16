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
page says Connected and the extension's popup says "Connected to your account".

## Using it

- Flagged posts are blurred, with a label naming the plugin, or collapsed to one line reading
  "Hidden by Brainrot Index: <plugin>". Click a blurred post to show it (not in child mode).
- While the server is still deciding about a post it is shown normally, or blurred in child mode.
  The extension keeps asking for up to 2 minutes while the post is on the page, then leaves it shown.
- A hidden post that was already above the top of the screen when its answer arrived is blurred
  instead, so the page never jumps under you. It is collapsed the next time the site redraws it.
- On Reddit, a hidden comment shows only its author line and the one-line notice; its replies stay
  visible.

## Reporting mistakes

- **Wrong?** on a blurred or hidden post's label: one click reports that it should not have been
  filtered. The label briefly says Recorded.
- **Right-click a post, "Brainrot Index: this should have been filtered"**: reports a post that
  should have been hidden. Outside a post it reports the page.
- **Popup text box**: free-text feedback, sent with the address of the tab you are on.

Every report carries the extension's code version, shown at the bottom of the popup.

## Popup

Shows whether the extension is connected, an on/off switch, how many posts were checked and how many
were blurred or hidden in this browser session, the feedback box, and a link to the site.

## Tests

See `extension-tests/README.md`. In short, from `extension-tests/`:

    npm test                      # against a built-in mock server
    BRAINROT_SERVER=https://brainrot.jacob-waters.com BRAINROT_TOKEN=<token> npm test
