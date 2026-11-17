import { createAuthForm } from '../components/AuthForm.js'
import { requestPasswordReset } from '../lib/auth.js'

export function mountForgotPasswordPage() {
  const footer = document.createElement('div')
  footer.innerHTML =
    'Remembered it? <a href="/login" class="text-glow-400 hover:text-glow-300">Sign in</a>'

  const form = createAuthForm({
    title: 'Forgot password',
    subtitle: "Enter your email and we'll send you a reset link.",
    fields: [
      { name: 'email', type: 'email', placeholder: 'you@example.com', autocomplete: 'username' },
    ],
    submitLabel: 'Send reset link',
    footerEl: footer,
    onSubmit: async ({ email }) => {
      const result = await requestPasswordReset(email)
      if (result.ok) {
        // Intentionally vague to avoid revealing which emails exist.
        form.setError('If that email exists, we sent a link. Check your inbox.', 'warning')
      }
      return result
    },
  })

  return { el: form.el }
}
