import { getState, subscribe, resendVerification, requestPasswordReset } from '../lib/auth.js'
import { el } from '../lib/dom.js'

const AMBER_BUTTON_CLASS = 'px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-colors'

export function mountAccountPage() {
  const container = el('div', 'max-w-2xl mx-auto px-4 py-12')

  let lastSnapshot = ''

  function render() {
    const { isAuthenticated, email, emailVerified, authProvider } = getState()

    // Logout while on this page: skip rendering; Layout's logout handler
    // navigates away and the router guard covers deep links.
    if (!isAuthenticated) return

    const hasUsablePassword = authProvider !== 'google'
    const snapshot = `${email}|${emailVerified}|${authProvider}`
    if (snapshot === lastSnapshot) return
    lastSnapshot = snapshot

    container.replaceChildren(
      el('h1', 'text-3xl font-bold mb-1 text-white', 'Account'),
      el('p', 'text-white/60 mb-8', email),
    )

    // -- Sign-in methods card --
    // Send-reset-link row: the only path to set or change a password.
    // Doing it via email means a hijacked session can't lock the real owner out.
    const resetBtn = el('button', 'shrink-0 ' + AMBER_BUTTON_CLASS,
      hasUsablePassword ? 'Email reset link' : 'Email setup link')
    resetBtn.type = 'button'
    resetBtn.addEventListener('click', async () => {
      resetBtn.disabled = true
      const original = resetBtn.textContent
      resetBtn.textContent = 'Sending...'
      await requestPasswordReset(email)
      resetBtn.textContent = 'Check your email'
      setTimeout(() => {
        resetBtn.disabled = false
        resetBtn.textContent = original
      }, 4000)
    })

    container.appendChild(el('div', 'rounded-2xl border border-white/10 bg-black/30 p-6 mb-6',
      el('h2', 'text-lg font-semibold text-white mb-4', 'Sign-in methods'),
      el('div', 'flex flex-col gap-3 text-sm',
        el('div', 'flex items-center justify-between',
          el('span', '', 'Google'),
          authProvider === 'google' || authProvider === 'hybrid'
            ? el('span', 'text-emerald-400', 'Google linked')
            : el('span', 'text-white/50', 'Google not linked - sign in with Google once to link it')),
        el('div', 'flex items-center justify-between',
          el('span', '', 'Password'),
          hasUsablePassword
            ? el('span', 'text-emerald-400', 'Password set')
            : el('span', 'text-white/50', 'No password set')),
      ),
      el('div', 'mt-5 pt-5 border-t border-white/10 flex items-center justify-between gap-4',
        el('p', 'text-sm text-white/60', hasUsablePassword
          ? 'To change your password, request an email reset link.'
          : 'To set a password, request an email reset link.'),
        resetBtn,
      ),
    ))

    // -- Email verification card --
    if (!emailVerified) {
      const resendBtn = el('button', AMBER_BUTTON_CLASS, 'Resend email')
      resendBtn.addEventListener('click', async () => {
        resendBtn.disabled = true
        resendBtn.textContent = 'Sending...'
        await resendVerification()
        resendBtn.textContent = 'Sent!'
        setTimeout(() => {
          resendBtn.disabled = false
          resendBtn.textContent = 'Resend email'
        }, 3000)
      })
      container.appendChild(el('div', 'rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 mb-6',
        el('h2', 'text-lg font-semibold text-amber-400 mb-1', 'Verify your email'),
        el('p', 'text-sm text-white/60 mb-4', "We sent you a verification link. Didn't get it?"),
        resendBtn,
      ))
    }
  }

  render()
  const unsubscribe = subscribe(() => render())

  return {
    el: container,
    cleanup: unsubscribe,
  }
}
