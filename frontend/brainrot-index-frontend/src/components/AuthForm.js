// Reusable auth form shell. Each form has an idle -> submitting -> (success | error)
// cycle with button busy state and inline error banner.
//
// Fields are declared as simple objects so each page can stay tiny:
//   createAuthForm({
//     title: 'Sign in',
//     fields: [{ name: 'email', type: 'email', placeholder: 'Email' }],
//     submitLabel: 'Sign in',
//     onSubmit: async ({ email, password }) => { ... },
//   })

import { createErrorBanner } from './ErrorBanner.js'
import { el } from '../lib/dom.js'
import { createPasswordField } from './PasswordField.js'

export function createAuthForm({
  title,
  subtitle = '',
  fields,
  submitLabel,
  onSubmit,
  footerEl = null,
  successMessage = '',
}) {
  const card = el('div', 'rounded-2xl border border-white/10 bg-black/30 p-8',
    el('h1', 'text-2xl font-bold mb-1 text-white', title),
    subtitle ? el('p', 'text-sm text-white/60 mb-6', subtitle) : el('div', 'mb-6'),
  )

  // -- Error banner slot --
  let errorSlot = el('div')
  card.appendChild(errorSlot)

  function setError(message, variant = 'error') {
    const next = createErrorBanner(message, variant)
    errorSlot.replaceWith(next)
    errorSlot = next
  }

  // -- Field rendering --
  const form = el('form', 'flex flex-col gap-4')
  form.noValidate = true

  const fieldGetters = {}

  for (const field of fields) {
    const wrapper = el('div', 'flex flex-col gap-1.5')

    if (field.label) {
      wrapper.appendChild(el('label', 'text-xs font-medium text-white/60 uppercase tracking-wide', field.label))
    }

    let fieldInput
    if (field.type === 'password') {
      const pf = createPasswordField({
        placeholder: field.placeholder,
        autocomplete: field.autocomplete || 'current-password',
      })
      wrapper.appendChild(pf.el)
      fieldGetters[field.name] = pf.getValue
      fieldInput = pf.input
    } else {
      const input = el('input',
        'w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder-white/30 focus:border-amber-500 focus:outline-none transition-colors')
      input.type = field.type || 'text'
      input.placeholder = field.placeholder || ''
      input.autocomplete = field.autocomplete || 'off'
      wrapper.appendChild(input)
      fieldGetters[field.name] = () => input.value
      fieldInput = input
    }
    // Ensure Enter submits the form even when there are multiple fields -
    // some browser/autofill combinations swallow implicit submission.
    fieldInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (typeof form.requestSubmit === 'function') form.requestSubmit()
        else form.dispatchEvent(new Event('submit', { cancelable: true }))
      }
    })
    form.appendChild(wrapper)
  }

  // -- Submit button --
  const submitBtn = el('button',
    'mt-2 w-full py-3 rounded-xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black transition-all disabled:opacity-60',
    submitLabel)
  submitBtn.type = 'submit'
  form.appendChild(submitBtn)

  let phase = 'idle'

  function setPhase(nextPhase) {
    phase = nextPhase
    if (phase === 'submitting') {
      submitBtn.disabled = true
      submitBtn.textContent = 'Please wait...'
    } else {
      submitBtn.disabled = false
      submitBtn.textContent = submitLabel
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (phase === 'submitting') return

    setError('')
    setPhase('submitting')

    const values = {}
    for (const field of fields) {
      values[field.name] = fieldGetters[field.name]().trim()
    }

    try {
      const result = await onSubmit(values)
      if (result && result.ok === false) {
        setError(result.error || 'Something went wrong.')
        setPhase('idle')
        return
      }
      if (successMessage) {
        setError(successMessage, 'warning')
      }
      setPhase('idle')
    } catch (err) {
      console.error('Auth form error:', err)
      setError('Something went wrong. Please try again.')
      setPhase('idle')
    }
  })

  card.appendChild(form)

  if (footerEl) {
    card.appendChild(el('div', 'mt-6 pt-6 border-t border-white/10 text-center text-sm text-white/50', footerEl))
  }

  const container = el('div', 'max-w-md mx-auto px-4 py-12', card)

  function getValue(name) {
    return fieldGetters[name]().trim()
  }

  return { el: container, setError, setPhase, getValue }
}
