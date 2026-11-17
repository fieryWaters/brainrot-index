// How to install the browser extension. Once the Chrome Web Store listing is
// live (WEBSTORE_URL set at build time) this is a single "Add to browser"
// button; until then it walks through Load unpacked from the downloaded zip.

import { el } from '../lib/dom.js'
import { getState } from '../lib/auth.js'
import { detectExtension } from '../lib/extension.js'
import { EXTENSION_ZIP_URL, WEBSTORE_URL } from '../lib/site.js'

const PRIMARY_LINK_CLASS = 'inline-block px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-shield-400 to-shield-600 hover:to-shield-400 hover:shadow-lg hover:shadow-glow-400/20 text-white transition-all'
const SMALL_BUTTON_CLASS = 'px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 transition-colors'
const TAB_CLASS = 'px-4 py-2 rounded-lg text-sm font-semibold transition-colors'
const SELECTED_TAB_CLASS = `${TAB_CLASS} bg-shield-400/25 text-glow-300`
const UNSELECTED_TAB_CLASS = `${TAB_CLASS} text-white/60 hover:text-white hover:bg-white/5`

const BROWSERS = {
  brave: { name: 'Brave', extensionsAddress: 'brave://extensions' },
  chrome: { name: 'Chrome', extensionsAddress: 'chrome://extensions' },
}

// Brave tells pages it is Brave; every other browser gets the Chrome steps.
function detectBrowser() {
  if (navigator.brave) return 'brave'
  return 'chrome'
}

function step(number, title, ...body) {
  return el('li', 'flex gap-4',
    el('span', 'shrink-0 w-8 h-8 rounded-full bg-shield-400/25 text-glow-300 font-bold flex items-center justify-center', String(number)),
    el('div', 'pt-1 min-w-0',
      el('h3', 'font-semibold text-white', title),
      el('div', 'mt-1 text-white/70 space-y-2', ...body)))
}

function paragraph(...children) {
  return el('p', '', ...children)
}

function strong(text) {
  return el('strong', 'text-white', text)
}

// The extensions page address, with a Copy button: web pages cannot link to it.
function copyableAddress(address) {
  const code = el('code', 'px-2 py-1 rounded bg-black/40 border border-white/10 text-glow-200 text-sm', address)
  const copyButton = el('button', SMALL_BUTTON_CLASS, 'Copy')
  copyButton.type = 'button'
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(address)
      copyButton.textContent = 'Copied'
    } catch {
      copyButton.textContent = 'Select and copy it'
    }
  })
  return el('div', 'flex items-center gap-2 flex-wrap', code, copyButton)
}

function manualSteps(browser) {
  const downloadLink = el('a', PRIMARY_LINK_CLASS, 'Download the extension')
  downloadLink.href = EXTENSION_ZIP_URL
  downloadLink.setAttribute('download', '')

  const dashboardLink = el('a', 'text-glow-400 hover:text-glow-300 underline', 'your dashboard')
  dashboardLink.href = getState().isAuthenticated ? '/dashboard' : '/signup'

  return el('ol', 'space-y-8',
    step(1, 'Download it',
      paragraph(downloadLink),
      paragraph('This saves a file called brainrot-index-extension.zip in your Downloads folder.')),
    step(2, 'Unzip it',
      paragraph('Open your Downloads folder and double-click the zip file. On a Mac this makes a folder called ',
        strong('brainrot-index-extension'), ' right next to it. On Windows, right-click the file, choose ',
        strong('Extract All'), ', then ', strong('Extract'), '.'),
      paragraph(`Keep that folder where it is. ${browser.name} loads the extension from it, so deleting or moving it later removes the extension.`)),
    step(3, `Open ${browser.name}'s extensions page`,
      paragraph('Copy this address, paste it into the address bar, and press Enter:'),
      copyableAddress(browser.extensionsAddress)),
    step(4, 'Turn on Developer mode',
      paragraph('Find the ', strong('Developer mode'), ' switch in the top right corner of that page and turn it on. A row of new buttons appears.')),
    step(5, 'Load the folder',
      paragraph('Click ', strong('Load unpacked'), ', choose the ', strong('brainrot-index-extension'),
        ' folder from step 2 (the folder, not the zip file), and click ', strong('Select'), '.'),
      paragraph('BrainRot Index now shows up in the list of extensions.')),
    step(6, 'Pin it to the toolbar (optional)',
      paragraph('Click the puzzle piece icon next to the address bar, then the pin next to BrainRot Index. Its button shows whether it is connected and how many posts it has checked.')),
    step(7, 'Connect it to your account',
      paragraph('Open ', dashboardLink, ' and press ', strong('Connect extension'), '. That is it: open X, Reddit or YouTube and your feed is filtered.')))
}

export function mountInstallPage() {
  const container = el('div', 'max-w-2xl mx-auto px-4 py-12')
  const installedNotice = el('div', 'hidden')

  container.append(
    el('h1', 'text-3xl font-bold text-white', 'Install the extension'),
    el('p', 'mt-2 text-white/60', 'BrainRot Index works in Brave and Google Chrome on a computer. Other browsers built on Chrome, such as Microsoft Edge, work the same way. Phones are not supported yet.'),
    installedNotice,
  )

  if (WEBSTORE_URL) {
    const storeLink = el('a', PRIMARY_LINK_CLASS, 'Add to Brave or Chrome')
    storeLink.href = WEBSTORE_URL
    storeLink.target = '_blank'
    storeLink.rel = 'noopener'
    const dashboardLink = el('a', 'text-glow-400 hover:text-glow-300 underline', 'your dashboard')
    dashboardLink.href = getState().isAuthenticated ? '/dashboard' : '/signup'
    container.append(
      el('div', 'mt-8 rounded-2xl border border-white/10 bg-black/30 p-6',
        storeLink,
        el('p', 'mt-4 text-white/70', 'The Chrome Web Store opens. Click ', strong('Add to Chrome'),
          ' (Brave uses the same store), then come back to ', dashboardLink, ' and press ', strong('Connect extension'), '.')))
  } else {
    let browserKey = detectBrowser()
    const stepsSlot = el('div', 'mt-8')
    const tabs = el('div', 'mt-8 flex gap-2')
    tabs.setAttribute('role', 'tablist')

    function render() {
      tabs.replaceChildren(...Object.entries(BROWSERS).map(([key, browser]) => {
        const tab = el('button', key === browserKey ? SELECTED_TAB_CLASS : UNSELECTED_TAB_CLASS, browser.name)
        tab.type = 'button'
        tab.setAttribute('role', 'tab')
        tab.setAttribute('aria-selected', String(key === browserKey))
        tab.addEventListener('click', () => {
          browserKey = key
          render()
        })
        return tab
      }))
      stepsSlot.replaceChildren(manualSteps(BROWSERS[browserKey]))
    }
    render()

    container.append(
      el('div', 'mt-6 rounded-xl border border-glow-400/20 bg-shield-400/10 p-4 text-sm text-white/70',
        el('p', 'font-semibold text-glow-300', 'A one-click install is coming'),
        el('p', 'mt-1', 'BrainRot Index is waiting for its listing in the Chrome Web Store. Until then you install it by hand, which takes about two minutes and is done once.')),
      tabs,
      stepsSlot,
      el('div', 'mt-12 border-t border-white/10 pt-6 text-sm text-white/50 space-y-2',
        el('h2', 'font-semibold text-white/70', 'Updating to a new version'),
        el('p', '', 'Download the zip again, unzip it, and put the new files in place of the ones in your brainrot-index-extension folder. Then press the round reload arrow on the BrainRot Index card on the extensions page.')),
    )
  }

  const stopDetecting = detectExtension(() => {
    installedNotice.className = 'mt-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-300'
    installedNotice.textContent = 'The extension is already installed in this browser.'
  })

  return { el: container, cleanup: stopDetecting }
}
