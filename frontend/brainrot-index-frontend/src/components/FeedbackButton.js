// A small fixed "Feedback" button on every page, for everyone, signed in or not.
// It opens a text box and sends the note, with the current page address, to
// /api/feedback/. The server stamps each report with the site's commit.

import { apiFetch } from '../lib/api.js'
import { el } from '../lib/dom.js'

// The git commit this build came from, passed in by deploy.sh.
const GIT_COMMIT = import.meta.env.VITE_GIT_COMMIT || 'unknown'

// What the reader is told when a report could not be stored.
function failureMessage(response) {
  if (response.status === 0) {
    return 'Not sent: cannot reach the server. Check your connection and try again.'
  }
  if (response.status === 403) {
    return 'Not sent: your session has expired. Reload the page and try again.'
  }
  if (response.status === 429) {
    return 'Not sent: too many reports from this address. Please try again in an hour.'
  }
  return `Not sent: the server answered with error ${response.status}. Please try again.`
}

export function createFeedbackButton() {
  const toggleButton = el('button',
    'px-4 py-2 rounded-full text-sm font-semibold bg-shield-400 hover:bg-shield-500 text-white shadow-lg shadow-black/40 transition-colors',
    'Feedback')
  toggleButton.type = 'button'
  toggleButton.setAttribute('aria-expanded', 'false')

  const textBox = el('textarea',
    'w-full h-28 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-white placeholder-white/30 focus:border-glow-400 focus:outline-none')
  textBox.placeholder = 'What went wrong, or what should change?'
  textBox.setAttribute('aria-label', 'Feedback')

  const status = el('p', 'text-xs text-white/60')
  status.setAttribute('role', 'status')
  const sendButton = el('button',
    'px-3 py-1.5 rounded-lg text-xs font-semibold bg-shield-400/25 hover:bg-shield-400/40 text-glow-300 transition-colors disabled:opacity-60',
    'Send')
  sendButton.type = 'button'

  const panel = el('div', 'hidden mb-2 w-80 p-4 rounded-xl bg-navy-900 border border-white/10 shadow-2xl shadow-black/50 flex-col gap-2',
    el('p', 'text-sm font-semibold text-white', 'Send feedback'),
    textBox,
    el('p', 'text-xs text-white/40', `Sent with this page's address and site version ${GIT_COMMIT}.`),
    el('div', 'flex items-center justify-between gap-2', status, sendButton))

  toggleButton.addEventListener('click', () => {
    const opening = panel.classList.contains('hidden')
    panel.classList.toggle('hidden')
    panel.classList.toggle('flex')
    toggleButton.setAttribute('aria-expanded', String(opening))
    status.textContent = ''
    if (opening) textBox.focus()
  })

  sendButton.addEventListener('click', async () => {
    const text = textBox.value.trim()
    if (!text) {
      status.textContent = 'Write a few words first.'
      return
    }
    sendButton.disabled = true
    status.textContent = 'Sending...'
    const { response } = await apiFetch('/feedback/', {
      method: 'POST',
      body: { source: 'site', text, page_url: window.location.href },
    })
    sendButton.disabled = false
    if (response.ok) {
      textBox.value = ''
      status.textContent = 'Thanks, sent.'
    } else {
      status.textContent = failureMessage(response)
    }
  })

  const widget = el('div', 'fixed bottom-4 right-4 z-50',
    el('div', 'flex flex-col items-end', panel, toggleButton))
  return { el: widget }
}
