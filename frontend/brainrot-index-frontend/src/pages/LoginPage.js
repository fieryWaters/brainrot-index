import { createAuthForm } from '../components/AuthForm.js'
import { createGoogleSignIn } from '../components/GoogleSignIn.js'
import { GOOGLE_CLIENT_ID, loginWithPassword, subscribe } from '../lib/auth.js'
import { navigate } from '../lib/router.js'

export function mountLoginPage() {
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

  const forgotRow = document.createElement('div')
  forgotRow.className = 'mt-2'
  const forgotLink = document.createElement('a')
  forgotLink.href = '/forgot-password'
  forgotLink.className = 'text-amber-400 hover:text-amber-300'
  forgotLink.textContent = 'Forgot password?'
  forgotRow.appendChild(forgotLink)
  footer.appendChild(forgotRow)

  const signupRow = document.createElement('div')
  signupRow.innerHTML =
    'New here? <a href="/signup" class="text-amber-400 hover:text-amber-300">Create an account</a>'
  footer.appendChild(signupRow)

  const form = createAuthForm({
    title: 'Sign in',
    subtitle: 'Welcome back to Brainrot Index.',
    fields: [
      { name: 'email', type: 'email', placeholder: 'you@example.com', autocomplete: 'username' },
      { name: 'password', type: 'password', placeholder: 'Password', autocomplete: 'current-password' },
    ],
    submitLabel: 'Sign in',
    footerEl: footer,
    onSubmit: async ({ email, password }) => {
      const result = await loginWithPassword(email, password)
      if (result.ok) navigate('/dashboard')
      return result
    },
  })

  // If Google sign-in completes while we're on this page, navigate home.
  const unsubscribe = subscribe((state) => {
    if (state.isAuthenticated) navigate('/dashboard')
  })

  return {
    el: form.el,
    cleanup() {
      unsubscribe()
      if (gsi) gsi.destroy()
    },
  }
}
