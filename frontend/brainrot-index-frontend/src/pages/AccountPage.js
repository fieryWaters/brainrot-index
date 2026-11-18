// Account: email verification, sign-in methods and password, signing out of
// every browser, downloading your data, and deleting the account.

import { apiFetch } from '../lib/api.js'
import { getState, subscribe, logout, resendVerification, requestPasswordReset } from '../lib/auth.js'
import { el } from '../lib/dom.js'
import { navigate } from '../lib/router.js'
import { createPasswordField } from '../components/PasswordField.js'
import { SUPPORT_EMAIL } from '../lib/site.js'

const CARD_CLASS = 'rounded-2xl border border-white/10 bg-black/30 p-6 mb-6'
const ACCENT_BUTTON_CLASS = 'px-4 py-2 rounded-lg text-sm font-semibold bg-shield-400/25 hover:bg-shield-400/40 text-glow-300 transition-colors disabled:opacity-60'
const DANGER_BUTTON_CLASS = 'px-4 py-2 rounded-lg text-sm font-semibold bg-red-500/80 hover:bg-red-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
const INPUT_CLASS = 'w-full px-4 py-3 rounded-xl bg-black/30 border border-white/10 text-white placeholder-white/30 focus:border-glow-400 focus:outline-none transition-colors'

function statusLine() {
  const line = el('p', 'text-sm mt-3 text-white/60')
  line.setAttribute('role', 'status')
  return line
}

function createVerifyCard() {
  const resendBtn = el('button', ACCENT_BUTTON_CLASS, 'Resend email')
  resendBtn.type = 'button'
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
  return el('div', 'rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 mb-6',
    el('h2', 'text-lg font-semibold text-amber-400 mb-1', 'Verify your email'),
    el('p', 'text-sm text-white/60 mb-4', "We sent you a verification link. Didn't get it?"),
    resendBtn)
}

// The reset link is the way to set a first password, or to change one you forgot:
// it goes to the inbox, so a stolen session alone cannot take the account over.
function createResetLinkButton(email, label) {
  const button = el('button', 'shrink-0 ' + ACCENT_BUTTON_CLASS, label)
  button.type = 'button'
  button.addEventListener('click', async () => {
    button.disabled = true
    button.textContent = 'Sending...'
    await requestPasswordReset(email)
    button.textContent = 'Check your email'
    setTimeout(() => {
      button.disabled = false
      button.textContent = label
    }, 4000)
  })
  return button
}

function createChangePasswordForm() {
  const current = createPasswordField({ placeholder: 'Current password', autocomplete: 'current-password' })
  current.input.setAttribute('aria-label', 'Current password')
  const next = createPasswordField({ placeholder: 'New password, at least 12 characters', autocomplete: 'new-password' })
  next.input.setAttribute('aria-label', 'New password')
  const status = statusLine()
  const submit = el('button', ACCENT_BUTTON_CLASS, 'Change password')
  submit.type = 'submit'

  const form = el('form', 'flex flex-col gap-3', current.el, next.el, el('div', '', submit), status)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    submit.disabled = true
    const { response, data } = await apiFetch('/account/change-password/', {
      method: 'POST',
      body: { current_password: current.getValue(), new_password: next.getValue() },
    })
    submit.disabled = false
    if (response.ok) {
      current.input.value = ''
      next.input.value = ''
      status.textContent = 'Password changed. Every other browser has been signed out.'
      return
    }
    status.textContent = data.error || 'Could not change the password. Please try again.'
  })
  return form
}

function createSignInCard(email, authProvider) {
  const hasPassword = authProvider !== 'google'
  const card = el('div', CARD_CLASS,
    el('h2', 'text-lg font-semibold text-white mb-4', 'Sign-in methods'),
    el('div', 'flex flex-col gap-3 text-sm',
      el('div', 'flex items-center justify-between gap-4',
        el('span', '', 'Google'),
        authProvider === 'google' || authProvider === 'hybrid'
          ? el('span', 'text-emerald-400', 'Google linked')
          : el('span', 'text-white/50 text-right', 'Not linked. Sign in with Google once to link it.')),
      el('div', 'flex items-center justify-between gap-4',
        el('span', '', 'Password'),
        hasPassword
          ? el('span', 'text-emerald-400', 'Password set')
          : el('span', 'text-white/50', 'No password set'))))

  if (hasPassword) {
    card.append(
      el('div', 'mt-5 pt-5 border-t border-white/10',
        el('h3', 'text-sm font-semibold text-white mb-3', 'Change your password'),
        createChangePasswordForm()),
      el('div', 'mt-5 pt-5 border-t border-white/10 flex items-center justify-between gap-4',
        el('p', 'text-sm text-white/60', 'Forgot your current password? We can email you a link to set a new one.'),
        createResetLinkButton(email, 'Email reset link')))
  } else {
    card.append(el('div', 'mt-5 pt-5 border-t border-white/10 flex items-center justify-between gap-4',
      el('p', 'text-sm text-white/60', 'To also sign in with a password, request a setup link by email.'),
      createResetLinkButton(email, 'Email setup link')))
  }
  return card
}

function createSignOutEverywhereCard() {
  const status = statusLine()
  const button = el('button', 'shrink-0 ' + ACCENT_BUTTON_CLASS, 'Sign out everywhere')
  button.type = 'button'
  button.addEventListener('click', async () => {
    button.disabled = true
    const { response } = await apiFetch('/account/sign-out-everywhere/', { method: 'POST' })
    if (!response.ok) {
      button.disabled = false
      status.textContent = 'Could not sign out everywhere. Please try again.'
      return
    }
    await logout()
    navigate('/login')
  })
  return el('div', CARD_CLASS,
    el('div', 'flex items-center justify-between gap-4',
      el('div', '',
        el('h2', 'text-lg font-semibold text-white mb-1', 'Signed-in browsers'),
        el('p', 'text-sm text-white/60',
          'Signs this account out of every browser, this one too, and disconnects every extension. Each extension then needs Connect extension pressed again.')),
      button),
    status)
}

function createExportCard() {
  const download = el('a', 'shrink-0 ' + ACCENT_BUTTON_CLASS, 'Download my data')
  download.href = '/api/account/export/'
  download.setAttribute('download', '')
  return el('div', CARD_CLASS,
    el('div', 'flex items-center justify-between gap-4',
      el('div', '',
        el('h2', 'text-lg font-semibold text-white mb-1', 'Your data'),
        el('p', 'text-sm text-white/60',
          'A JSON file with your account details, subscription, settings, filters and every report you sent us.')),
      download))
}

function createDeleteCard(email, onDeleted) {
  const confirmInput = el('input', INPUT_CLASS)
  confirmInput.type = 'email'
  confirmInput.autocomplete = 'off'
  confirmInput.placeholder = email
  confirmInput.setAttribute('aria-label', 'Type your email address to confirm')

  const deleteButton = el('button', DANGER_BUTTON_CLASS, 'Delete my account')
  deleteButton.type = 'button'
  deleteButton.disabled = true
  const status = statusLine()

  confirmInput.addEventListener('input', () => {
    deleteButton.disabled = confirmInput.value.trim().toLowerCase() !== email.toLowerCase()
  })

  deleteButton.addEventListener('click', async () => {
    deleteButton.disabled = true
    status.textContent = 'Deleting...'
    const { response, data } = await apiFetch('/account/delete/', {
      method: 'POST',
      body: { email: confirmInput.value },
    })
    if (!response.ok) {
      deleteButton.disabled = false
      status.textContent = data.error || `Could not delete the account. Please try again, or write to ${SUPPORT_EMAIL}.`
      return
    }
    onDeleted()
  })

  return el('div', 'rounded-2xl border border-red-500/30 bg-red-500/5 p-6 mb-6',
    el('h2', 'text-lg font-semibold text-red-300 mb-2', 'Delete your account'),
    el('p', 'text-sm text-white/70', 'This cannot be undone. Deleting removes:'),
    el('ul', 'mt-2 ml-5 list-disc text-sm text-white/70 space-y-1',
      el('li', '', 'your account, email address and password'),
      el('li', '', 'your settings and the filters you installed'),
      el('li', '', 'every extension connection (each extension stops filtering)'),
      el('li', '', 'the reports and feedback you sent us, and your plugin ratings and reports'),
      el('li', '', 'your place in your family (if you are its only admin and others are in it, make someone else an admin first)'),
      el('li', '', 'your name on plugins you published (the plugins stay for the people who installed them)'),
      el('li', '', 'your subscription, which is canceled at once with no further charges')),
    el('p', 'mt-3 text-sm text-white/70',
      "Posts the extension sent us, and the filters' verdicts on them, stay in the shared cache. Their link to your account is removed. Stripe, our payment processor, keeps its own records of past payments."),
    el('p', 'mt-4 text-sm text-white/70', 'To confirm, type your email address:'),
    el('div', 'mt-2 flex flex-col sm:flex-row gap-3', confirmInput, deleteButton),
    status)
}

export function mountAccountPage() {
  const container = el('div', 'max-w-2xl mx-auto px-4 py-12')

  let lastSnapshot = ''
  let deleted = false

  function showDeleted() {
    deleted = true
    const homeLink = el('a', 'inline-block mt-6 px-5 py-2.5 rounded-xl font-semibold bg-white/10 hover:bg-white/20 transition-colors', 'Go to the home page')
    homeLink.href = '/'
    container.replaceChildren(
      el('h1', 'text-3xl font-bold mb-3 text-white', 'Your account is deleted'),
      el('p', 'text-white/60', 'Everything listed on the previous screen has been removed. You can remove the extension from your browser too: open its extensions page and click Remove on the BrainRot Index card.'),
      homeLink)
    logout()
  }

  function render() {
    const { isAuthenticated, email, emailVerified, authProvider } = getState()

    // Logout while on this page: skip rendering; Layout's logout handler
    // navigates away and the router guard covers deep links.
    if (!isAuthenticated || deleted) return

    const snapshot = `${email}|${emailVerified}|${authProvider}`
    if (snapshot === lastSnapshot) return
    lastSnapshot = snapshot

    container.replaceChildren(
      el('h1', 'text-3xl font-bold mb-1 text-white', 'Account'),
      el('p', 'text-white/60 mb-8', email),
    )
    if (!emailVerified) container.append(createVerifyCard())
    container.append(
      createSignInCard(email, authProvider),
      createSignOutEverywhereCard(),
      createExportCard(),
      createDeleteCard(email, showDeleted),
    )
  }

  render()
  const unsubscribe = subscribe(() => render())

  return {
    el: container,
    cleanup: unsubscribe,
  }
}
