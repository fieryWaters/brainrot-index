import { createAuthForm } from '../components/AuthForm.js'
import { confirmPasswordReset } from '../lib/auth.js'
import { navigate } from '../lib/router.js'

export function mountResetPasswordPage() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token') || ''

  const root = document.createElement('div')

  if (!token) {
    const empty = document.createElement('div')
    empty.className = 'max-w-md mx-auto px-4 py-12 text-center text-white/60'
    empty.textContent = 'This reset link is missing its token.'
    root.appendChild(empty)
    return { el: root }
  }

  function renderSuccess() {
    root.innerHTML = ''
    const container = document.createElement('div')
    container.className = 'max-w-md mx-auto px-4 py-12'

    const card = document.createElement('div')
    card.className = 'rounded-2xl border border-white/10 bg-black/30 p-8 text-center'

    const heading = document.createElement('h1')
    heading.className = 'text-2xl font-bold mb-2 text-white'
    heading.textContent = 'Your password has been set'
    card.appendChild(heading)

    const body = document.createElement('p')
    body.className = 'text-sm text-white/60 mb-6'
    body.textContent = "You're signed in and good to go."
    card.appendChild(body)

    const cta = document.createElement('button')
    cta.type = 'button'
    cta.className =
      'w-full py-3 rounded-xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black transition-all'
    cta.textContent = 'Continue'
    cta.addEventListener('click', () => navigate('/'))
    card.appendChild(cta)

    container.appendChild(card)
    root.appendChild(container)
  }

  const form = createAuthForm({
    title: 'Set a new password',
    subtitle: 'Choose a password that is at least 12 characters long.',
    fields: [
      { name: 'password', type: 'password', placeholder: 'New password', autocomplete: 'new-password' },
      { name: 'confirm', type: 'password', placeholder: 'Confirm password', autocomplete: 'new-password' },
    ],
    submitLabel: 'Update password',
    onSubmit: async ({ password, confirm }) => {
      if (password !== confirm) {
        return { ok: false, error: 'Passwords do not match.' }
      }
      const result = await confirmPasswordReset(token, password)
      if (result.ok) renderSuccess()
      return result
    },
  })

  root.appendChild(form.el)
  return { el: root }
}
