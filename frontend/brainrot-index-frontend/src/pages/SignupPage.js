import { createAuthForm } from '../components/AuthForm.js'
import { createGoogleSignIn } from '../components/GoogleSignIn.js'
import { GOOGLE_CLIENT_ID, getState, signupWithEmail, subscribe } from '../lib/auth.js'
import { navigate } from '../lib/router.js'

export function mountSignupPage() {
  const wrapper = document.createElement('div')

  const footer = document.createElement('div')
  footer.className = 'flex flex-col gap-3 items-center'

  let gsi = null
  if (GOOGLE_CLIENT_ID) {
    const divider = document.createElement('div')
    divider.className = 'text-xs text-white/30 uppercase tracking-wider'
    divider.textContent = 'or'
    footer.appendChild(divider)

    gsi = createGoogleSignIn()
    footer.appendChild(gsi.el)
  }

  const loginRow = document.createElement('div')
  loginRow.className = 'mt-2'
  loginRow.innerHTML =
    'Already have an account? <a href="/login" class="text-amber-400 hover:text-amber-300">Sign in</a>'
  footer.appendChild(loginRow)

  const form = createAuthForm({
    title: 'Create account',
    subtitle: 'Use at least 12 characters for your password.',
    fields: [
      { name: 'email', type: 'email', placeholder: 'you@example.com', autocomplete: 'username' },
      { name: 'password', type: 'password', placeholder: 'Password', autocomplete: 'new-password' },
    ],
    submitLabel: 'Create account',
    footerEl: footer,
    onSubmit: async ({ email, password }) => {
      const result = await signupWithEmail(email, password)
      if (!result.ok) return result
      // If the signup auto-upgraded to a verified login, we're done.
      const { isAuthenticated, emailVerified } = getState()
      if (isAuthenticated && emailVerified) {
        navigate('/dashboard')
      } else {
        showPendingConfirmation()
      }
      return result
    },
  })

  wrapper.appendChild(form.el)

  function showPendingConfirmation() {
    wrapper.innerHTML = ''
    const panel = document.createElement('div')
    panel.className = 'text-center text-white/80 max-w-md mx-auto'
    panel.innerHTML =
      '<h2 class="text-2xl text-amber-400 mb-3">Check your inbox</h2>' +
      '<p>If that email is available, we just sent a verification link. ' +
      'Click it to finish setting up your account.</p>'
    wrapper.appendChild(panel)
  }

  const unsubscribe = subscribe((state) => {
    if (state.isAuthenticated && state.emailVerified) navigate('/dashboard')
  })

  return {
    el: wrapper,
    cleanup() {
      unsubscribe()
      if (gsi) gsi.destroy()
    },
  }
}
