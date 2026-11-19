// Contact form, for everyone, signed in or not: a name (optional), an email
// address for the reply, a subject and a message. The server stores it in the
// owner's inbox and emails it to the owner with Reply-To set to that address,
// so the reply comes from the owner's mail client.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { getState } from '../lib/auth.js'
import { el } from '../lib/dom.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { CARD_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from '../components/styles.js'

function createField(labelText, input) {
  return el('label', 'flex flex-col gap-1.5', el('span', LABEL_CLASS, labelText), input)
}

function createInput(type, autocomplete) {
  const input = el('input', INPUT_CLASS)
  input.type = type
  input.autocomplete = autocomplete
  return input
}

export function mountContactPage() {
  const nameInput = createInput('text', 'name')
  const emailInput = createInput('email', 'email')
  emailInput.required = true
  // A signed-in sender is answered at their account's address unless they change it.
  emailInput.value = getState().email
  const subjectInput = createInput('text', 'off')
  subjectInput.required = true
  subjectInput.maxLength = 200
  const messageBox = el('textarea', `${INPUT_CLASS} h-40`)
  messageBox.required = true

  const sendButton = el('button', PRIMARY_BUTTON_CLASS, 'Send')
  sendButton.type = 'submit'

  let messageSlot = el('div')
  function showMessage(text, variant) {
    const next = createErrorBanner(text, variant)
    messageSlot.replaceWith(next)
    messageSlot = next
  }

  const form = el('form', `${CARD_CLASS} flex flex-col gap-4`,
    createField('Name (optional)', nameInput),
    createField('Email', emailInput),
    createField('Subject', subjectInput),
    createField('Message', messageBox),
    el('div', 'flex justify-end', sendButton))

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    sendButton.disabled = true
    const { response, data } = await apiFetch('/contact/', {
      method: 'POST',
      body: {
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        subject: subjectInput.value.trim(),
        message: messageBox.value.trim(),
      },
    })
    sendButton.disabled = false
    if (response.ok) {
      subjectInput.value = ''
      messageBox.value = ''
      showMessage("Thanks, sent. We'll reply to the email address you gave.", 'warning')
    } else if (response.status === 0) {
      showMessage('Not sent: cannot reach the server. Check your connection and try again.')
    } else if (response.status === 429) {
      showMessage('Not sent: too many messages from this address. Please try again in an hour.')
    } else {
      showMessage(errorMessageFrom(data, `Not sent: the server answered with error ${response.status}. Please try again.`))
    }
  })

  const root = el('div', 'max-w-xl mx-auto px-4 py-12',
    el('h1', 'text-3xl font-bold text-white', 'Contact us'),
    el('p', 'mt-2 mb-8 text-sm text-white/60',
      'Questions, requests about your data, or anything else. For a quick note on how the site is working, use the Feedback button instead.'),
    messageSlot,
    form)

  return { el: root }
}
