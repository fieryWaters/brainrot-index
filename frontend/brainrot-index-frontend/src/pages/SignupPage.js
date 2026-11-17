import { createAuthForm } from '../components/AuthForm.js'
import { createGoogleSignIn } from '../components/GoogleSignIn.js'
import {
  GOOGLE_CLIENT_ID,
  getState,
  setInviteCodeReaderForGoogle,
  signupWithEmail,
  subscribe,
} from '../lib/auth.js'
import { apiFetch } from '../lib/api.js'
import { navigate } from '../lib/router.js'

export function mountSignupPage() {
  const wrapper = document.createElement('div')

  const footer = document.createElement('div')
  footer.className = 'flex flex-col gap-3 items-center'

  const divider = document.createElement('div')
  divider.className = 'text-xs text-white/30 uppercase tracking-wider'
  divider.textContent = 'or'

  let gsi = null
  if (GOOGLE_CLIENT_ID) {
    footer.appendChild(divider)

    gsi = createGoogleSignIn()
    footer.appendChild(gsi.el)
  }

  const loginRow = document.createElement('div')
  loginRow.className = 'mt-2'
  loginRow.innerHTML =
    'Already have an account? <a href="/login" class="text-glow-400 hover:text-glow-300">Sign in</a>'
  footer.appendChild(loginRow)

  const termsRow = document.createElement('p')
  termsRow.className = 'text-xs text-white/40 text-center max-w-xs'
  termsRow.innerHTML =
    'By creating an account you agree to the <a href="/terms" class="underline hover:text-white/70">Terms of Service</a> ' +
    'and the <a href="/privacy" class="underline hover:text-white/70">Privacy Policy</a>.'
  footer.appendChild(termsRow)

  const form = createAuthForm({
    title: 'Create account',
    subtitle: 'Use at least 12 characters for your password.',
    fields: [
      { name: 'invite_code', type: 'text', placeholder: 'Invite code', autocomplete: 'off', hidden: true },
      { name: 'email', type: 'email', placeholder: 'you@example.com', autocomplete: 'username' },
      { name: 'password', type: 'password', placeholder: 'Password', autocomplete: 'new-password' },
    ],
    submitLabel: 'Create account',
    footerEl: footer,
    onSubmit: async ({ invite_code, email, password }) => {
      const result = await signupWithEmail(email, password, invite_code)
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

  setInviteCodeReaderForGoogle(() => form.getValue('invite_code'))

  // The server says whether new accounts need an invite code.
  apiFetch('/auth/csrf/').then(({ data }) => {
    if (data.signup_requires_invite) {
      form.setFieldVisible('invite_code', true)
      divider.textContent = 'or, with the invite code above'
    }
  })

  wrapper.appendChild(form.el)

  function showPendingConfirmation() {
    wrapper.innerHTML = ''
    const panel = document.createElement('div')
    panel.className = 'text-center text-white/80 max-w-md mx-auto'
    panel.innerHTML =
      '<h2 class="text-2xl text-glow-400 mb-3">Check your inbox</h2>' +
      '<p>If that email is available, we just sent a verification link. ' +
      'Click it to finish setting up your account.</p>' +
      '<p class="mt-4 text-sm text-white/60">While you wait, you can ' +
      '<a href="/install" class="text-glow-400 hover:text-glow-300 underline">install the extension</a>.</p>'
    wrapper.appendChild(panel)
  }

  const unsubscribe = subscribe((state) => {
    if (state.isAuthenticated && state.emailVerified) navigate('/dashboard')
    else if (state.authError) form.setError(state.authError)
  })

  return {
    el: wrapper,
    cleanup() {
      unsubscribe()
      setInviteCodeReaderForGoogle(() => '')
      if (gsi) gsi.destroy()
    },
  }
}
