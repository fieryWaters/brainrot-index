// The dashboard's setup checklist: verify the email, install the extension,
// connect it, open X or Reddit. Each step is done or not from real state: the
// server's /onboarding/ answer, and whether the extension answers on this page.
// Once every step is done it collapses to one line.

import { apiFetch } from '../lib/api.js'
import { getState, resendVerification } from '../lib/auth.js'
import { el } from '../lib/dom.js'

const CARD_CLASS = 'rounded-2xl border border-white/10 bg-black/30 p-6 mb-6'
const ACCENT_BUTTON_CLASS = 'px-3 py-1.5 rounded-lg text-sm font-semibold bg-shield-400/25 hover:bg-shield-400/40 text-glow-300 transition-colors disabled:opacity-60'
const LINK_CLASS = 'text-glow-400 hover:text-glow-300 underline'

function link(text, href, external = false) {
  const anchor = el('a', LINK_CLASS, text)
  anchor.href = href
  if (external) {
    anchor.target = '_blank'
    anchor.rel = 'noopener'
  }
  return anchor
}

const CHECK_ICON_SVG = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>'

function stepRow(done, title, ...hint) {
  let mark
  if (done) {
    mark = el('span', 'shrink-0 w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center')
    mark.innerHTML = CHECK_ICON_SVG
  } else {
    mark = el('span', 'shrink-0 w-6 h-6 rounded-full border-2 border-white/20')
  }
  mark.setAttribute('aria-hidden', 'true')
  const row = el('li', 'flex gap-3 py-3 border-t border-white/10 first:border-t-0',
    mark,
    el('div', 'min-w-0',
      el('p', done ? 'text-white/50 line-through' : 'text-white font-medium', title),
      done ? '' : el('div', 'mt-1 text-sm text-white/60', ...hint)))
  row.dataset.done = String(done)
  return row
}

function resendButton() {
  const button = el('button', ACCENT_BUTTON_CLASS, 'Resend the email')
  button.type = 'button'
  button.addEventListener('click', async () => {
    button.disabled = true
    button.textContent = 'Sending...'
    const result = await resendVerification()
    button.textContent = result.ok ? 'Sent. Check your inbox.' : 'Could not send. Try again.'
    if (!result.ok) button.disabled = false
  })
  return button
}

export function createOnboardingChecklist() {
  const card = el('div', CARD_CLASS)
  let status = null
  let extensionInstalled = false
  let expanded = false

  function render() {
    if (status === null) return

    const installed = extensionInstalled || status.extension_connected
    const steps = [
      stepRow(status.email_verified, 'Verify your email',
        el('p', 'mb-2', `We sent a link to ${getState().email}. Open it to confirm the address.`),
        resendButton()),
      stepRow(installed, 'Install the extension',
        el('p', '', 'Add Brainrot Index to Brave or Chrome. ', link('Show me how', '/install'))),
      stepRow(status.extension_connected, 'Connect the extension',
        el('p', '', installed
          ? 'Press Connect extension in the Browser extension card below.'
          : 'Once it is installed, press Connect extension in the Browser extension card below.')),
      stepRow(status.feed_opened, 'Open X or Reddit',
        el('p', '', 'Open ', link('x.com', 'https://x.com/home', true), ' or ',
          link('reddit.com', 'https://www.reddit.com/', true),
          ' in this browser. Posts your filters flag are blurred or hidden as you scroll.')),
    ]
    const doneCount = steps.filter((row) => row.dataset.done === 'true').length
    const allDone = doneCount === steps.length

    if (allDone && !expanded) {
      const showButton = el('button', 'text-sm text-white/50 hover:text-white', 'Show setup steps')
      showButton.type = 'button'
      showButton.addEventListener('click', () => {
        expanded = true
        render()
      })
      card.replaceChildren(el('div', 'flex items-center justify-between gap-4',
        el('p', 'text-emerald-400 font-medium', 'You are set up. Your X and Reddit feeds are being filtered.'),
        showButton))
      return
    }

    card.replaceChildren(
      el('div', 'flex items-baseline justify-between gap-4 mb-2',
        el('h2', 'text-lg font-semibold text-white', 'Get set up'),
        el('span', 'text-sm text-white/50', `${doneCount} of ${steps.length} done`)),
      el('ol', '', ...steps))
  }

  async function refresh() {
    const { response, data } = await apiFetch('/onboarding/')
    if (!response.ok) return
    status = data
    render()
  }

  function markExtensionInstalled() {
    extensionInstalled = true
    render()
  }

  // Steps are done in other tabs (the email link, X or Reddit), so look again on return.
  function handleFocus() {
    refresh()
  }
  window.addEventListener('focus', handleFocus)
  refresh()

  return {
    el: card,
    refresh,
    markExtensionInstalled,
    cleanup() {
      window.removeEventListener('focus', handleFocus)
    },
  }
}
