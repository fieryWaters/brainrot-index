// A small fixed "Feedback" button on every page, for everyone, signed in or not.
// It opens a thumbs up, a thumbs down and an optional text box together, and
// Send posts the rating and note, with the current page address, to
// /api/feedback/. Someone not signed in may add an email address for a reply.
// The server stamps each report with the site's commit; the owner reads it in the inbox.
// Longer messages go through the contact form at /contact.

import { apiFetch } from '../lib/api.js'
import { getState } from '../lib/auth.js'
import { el } from '../lib/dom.js'
import { createIcon } from './Icons.js'

const TEXT_PLACEHOLDER = 'What works, what went wrong, or what should change? (optional)'
const TEXT_PLACEHOLDERS = {
  up: 'What do you like? (optional)',
  down: 'What went wrong, or what should change? (optional)',
}

const RATING_BUTTON_CLASS = 'flex-1 flex items-center justify-center py-3 rounded-lg border text-sm font-medium transition-colors'
const RATING_IDLE_CLASS = 'border-white/10 bg-black/30 text-white/70 hover:text-white hover:border-white/30'
const RATING_CHOSEN_CLASS = 'border-glow-400 bg-shield-400/25 text-glow-300'

// The git commit this build came from, passed in by deploy.sh.
const GIT_COMMIT = import.meta.env.VITE_GIT_COMMIT || 'unknown'

// What the reader is told when a report could not be stored.
function failureMessage(response) {
  if (response.status === 0) {
    return 'Not sent: cannot reach the server. Check your connection and try again.'
  }
  if (response.status === 400) {
    return 'Not sent: check the email address and try again.'
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

  let rating = ''

  const textBox = el('textarea',
    'w-full h-24 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-white placeholder-white/30 focus:border-glow-400 focus:outline-none')
  textBox.setAttribute('aria-label', 'Feedback note')
  textBox.placeholder = TEXT_PLACEHOLDER

  const replyEmailBox = el('input',
    'w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-white placeholder-white/30 focus:border-glow-400 focus:outline-none')
  replyEmailBox.type = 'email'
  replyEmailBox.placeholder = 'Your email, if you want a reply (optional)'
  replyEmailBox.setAttribute('aria-label', 'Reply email')

  const status = el('p', 'text-xs text-white/60')
  status.setAttribute('role', 'status')
  const sendButton = el('button',
    'px-3 py-1.5 rounded-lg text-xs font-semibold bg-shield-400/25 hover:bg-shield-400/40 text-glow-300 transition-colors disabled:opacity-60',
    'Send')
  sendButton.type = 'button'

  const details = el('div', 'flex flex-col gap-2',
    textBox,
    replyEmailBox,
    el('p', 'text-xs text-white/40', `Sent with this page's address and site version ${GIT_COMMIT}.`),
    el('div', 'flex justify-end', sendButton))

  function createRatingButton(value, iconName, label) {
    const button = el('button', `${RATING_BUTTON_CLASS} ${RATING_IDLE_CLASS}`, createIcon(iconName, 'w-6 h-6'))
    button.type = 'button'
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => chooseRating(value))
    return button
  }
  const ratingButtons = {
    up: createRatingButton('up', 'thumbsUp', 'Thumbs up'),
    down: createRatingButton('down', 'thumbsDown', 'Thumbs down'),
  }

  function chooseRating(value) {
    rating = value
    for (const [buttonValue, button] of Object.entries(ratingButtons)) {
      const chosen = buttonValue === value
      button.className = `${RATING_BUTTON_CLASS} ${chosen ? RATING_CHOSEN_CLASS : RATING_IDLE_CLASS}`
      button.setAttribute('aria-pressed', String(chosen))
    }
    textBox.placeholder = TEXT_PLACEHOLDERS[value]
    status.textContent = ''
  }

  function clearRating() {
    rating = ''
    for (const button of Object.values(ratingButtons)) {
      button.className = `${RATING_BUTTON_CLASS} ${RATING_IDLE_CLASS}`
      button.setAttribute('aria-pressed', 'false')
    }
    textBox.placeholder = TEXT_PLACEHOLDER
  }

  const panel = el('div', 'hidden mb-2 w-80 max-w-[calc(100vw-2rem)] p-4 rounded-xl bg-navy-900 border border-white/10 shadow-2xl shadow-black/50 flex-col gap-3',
    el('p', 'text-sm font-semibold text-white', 'How is BrainRot Index working for you?'),
    el('div', 'flex gap-2', ratingButtons.up, ratingButtons.down),
    details,
    status)

  function setPanelOpen(open) {
    panel.classList.toggle('hidden', !open)
    panel.classList.toggle('flex', open)
    toggleButton.setAttribute('aria-expanded', String(open))
    status.textContent = ''
    // A signed-in sender is answered at their account's address.
    replyEmailBox.classList.toggle('hidden', getState().isAuthenticated)
    if (open) ratingButtons.up.focus()
  }

  toggleButton.addEventListener('click', () => setPanelOpen(panel.classList.contains('hidden')))

  sendButton.addEventListener('click', async () => {
    if (!rating && !textBox.value.trim()) {
      status.textContent = 'Pick a thumb or write a note first.'
      return
    }
    sendButton.disabled = true
    status.textContent = 'Sending...'
    const body = { source: 'site', rating, text: textBox.value.trim(), page_url: window.location.href }
    if (!getState().isAuthenticated) {
      body.reply_email = replyEmailBox.value.trim()
    }
    const { response } = await apiFetch('/feedback/', { method: 'POST', body })
    sendButton.disabled = false
    if (response.ok) {
      textBox.value = ''
      replyEmailBox.value = ''
      clearRating()
      status.textContent = 'Thanks, sent.'
    } else {
      status.textContent = failureMessage(response)
    }
  })

  const widget = el('div', 'fixed bottom-4 right-4 z-50',
    el('div', 'flex flex-col items-end', panel, toggleButton))
  return { el: widget }
}
