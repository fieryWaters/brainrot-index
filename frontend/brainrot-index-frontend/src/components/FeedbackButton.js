// A small fixed "Feedback" button for logged-in users. It opens a text box
// and sends the note, with the current page address, to /api/feedback/.

import { apiFetch } from '../lib/api.js'
import { el } from '../lib/dom.js'

export function createFeedbackButton() {
  const toggleButton = el('button',
    'px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-900 border border-white/10 text-white/70 hover:text-white transition-colors',
    'Feedback')
  toggleButton.type = 'button'

  const textBox = el('textarea',
    'w-full h-24 px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm text-white placeholder-white/30 focus:border-amber-500 focus:outline-none')
  textBox.placeholder = 'What went wrong, or what should change?'

  const status = el('p', 'text-xs text-white/50')
  const sendButton = el('button',
    'px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-colors disabled:opacity-60',
    'Send')
  sendButton.type = 'button'

  const panel = el('div', 'hidden mb-2 w-72 p-3 rounded-xl bg-gray-900 border border-white/10 shadow-2xl shadow-black/50 flex-col gap-2',
    textBox,
    el('div', 'flex items-center justify-between gap-2', status, sendButton))

  toggleButton.addEventListener('click', () => {
    panel.classList.toggle('hidden')
    panel.classList.toggle('flex')
    status.textContent = ''
  })

  sendButton.addEventListener('click', async () => {
    const text = textBox.value.trim()
    if (!text) return
    sendButton.disabled = true
    const { response } = await apiFetch('/feedback/', {
      method: 'POST',
      body: { source: 'site', text, page_url: window.location.href },
    })
    sendButton.disabled = false
    if (response.ok) {
      textBox.value = ''
      status.textContent = 'Thanks, sent.'
    } else {
      status.textContent = 'Could not send. Try again.'
    }
  })

  const widget = el('div', 'fixed bottom-4 right-4 z-50',
    el('div', 'flex flex-col items-end', panel, toggleButton))
  return { el: widget }
}
