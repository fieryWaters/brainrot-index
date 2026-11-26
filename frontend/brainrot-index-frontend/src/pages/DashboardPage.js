// Dashboard: the subscription, connect the browser extension, the master switch and mode, and
// one row of settings per installed plugin. Every change saves immediately.
// A child sees the settings without being able to change them.

import { apiFetch } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { mountBillingCard } from '../components/BillingCard.js'
import { createFilterSettingsCard, createInstalledPluginsCard } from '../components/FilterSettings.js'
import { CARD_CLASS, ACCENT_BUTTON_CLASS } from '../components/styles.js'
import { pendingFamilyInviteCode } from './JoinFamilyPage.js'
import { createOnboardingChecklist } from '../components/OnboardingChecklist.js'
import { getState } from '../lib/auth.js'
import {
  detectExtension, handTokenToExtension,
  CONNECTED_MESSAGE_TYPE, CONSENT_NEEDED_MESSAGE_TYPE, NOT_CONNECTED_STATE, CONSENT_NEEDED_STATE,
} from '../lib/extension.js'

export const EXTENSION_ANSWER_TIMEOUT_MS = 3000
const CONSENT_NEEDED_TEXT = 'Almost done: the extension sends nothing until you agree to its notice. Press the BrainRot Index button in your browser\'s toolbar, then Review and agree.'

export function mountDashboardPage() {
  const container = el('div', 'max-w-2xl mx-auto px-4 py-12')
  let errorSlot = el('div')

  function showError(message) {
    const next = createErrorBanner(message)
    errorSlot.replaceWith(next)
    errorSlot = next
  }

  // -- Browser extension --
  // The extension connects by itself on every page of this site (connectExtensionAutomatically
  // in main.js). The Connect extension button is shown only to an extension older than 0.2.0,
  // which waits to be handed a token.
  let extensionAnswerTimer = null
  const connectStatus = el('p', 'text-sm text-white/60')
  const connectButton = el('button', 'shrink-0 ' + ACCENT_BUTTON_CLASS, 'Connect extension')
  connectButton.type = 'button'
  connectButton.hidden = true
  connectButton.addEventListener('click', async () => {
    connectButton.disabled = true
    connectStatus.textContent = 'Connecting...'
    const outcome = await handTokenToExtension()
    connectButton.disabled = false
    if (outcome === 'email-not-verified') {
      connectStatus.textContent = 'Verify your email first: open the link we emailed you, or send a new one from Account settings. Then press Connect extension again.'
      return
    }
    if (outcome === 'failed') {
      connectStatus.textContent = 'Could not create a connection. Please try again.'
      return
    }
    clearTimeout(extensionAnswerTimer)
    extensionAnswerTimer = setTimeout(() => {
      connectStatus.textContent = 'The extension did not answer on this page. If you just installed or reloaded it, reload this page and press Connect extension again.'
    }, EXTENSION_ANSWER_TIMEOUT_MS)
  })

  function handleExtensionMessage(event) {
    if (event.origin !== window.location.origin) return
    if (event.data?.type === CONSENT_NEEDED_MESSAGE_TYPE) {
      clearTimeout(extensionAnswerTimer)
      connectStatus.textContent = 'Almost done: the extension opened a tab that explains what it sends. Press Agree and continue there.'
      checklist.refresh()
      return
    }
    if (event.data?.type !== CONNECTED_MESSAGE_TYPE) return
    clearTimeout(extensionAnswerTimer)
    connectStatus.textContent = 'Connected'
    checklist.refresh()
  }
  window.addEventListener('message', handleExtensionMessage)

  // accountState is undefined for an extension older than 0.2.0.
  function showExtensionState(accountState) {
    if (accountState === undefined) {
      connectStatus.textContent = 'Link the extension in this browser to your account.'
      connectButton.hidden = false
    } else if (accountState === CONSENT_NEEDED_STATE) {
      connectStatus.textContent = CONSENT_NEEDED_TEXT
    } else if (accountState === NOT_CONNECTED_STATE && !getState().emailVerified) {
      connectStatus.textContent = 'The extension connects to your account as soon as your email is verified.'
    } else if (accountState === NOT_CONNECTED_STATE) {
      connectStatus.textContent = 'Connecting...'
    } else {
      connectStatus.textContent = 'Connected'
    }
  }

  const connectCard = el('div', CARD_CLASS,
    el('div', 'flex items-center justify-between gap-4',
      el('div', '',
        el('h2', 'text-lg font-semibold text-white mb-1', 'Browser extension'),
        connectStatus),
      connectButton))
  const installLink = el('a', 'text-glow-400 hover:text-glow-300 underline', 'Install it first')
  installLink.href = '/install'
  connectStatus.append('The extension is not installed in this browser yet. ', installLink, '.')

  const checklist = createOnboardingChecklist()
  const stopDetectingExtension = detectExtension((accountState) => {
    checklist.markExtensionInstalled()
    showExtensionState(accountState)
  })

  container.append(
    el('h1', 'text-3xl font-bold mb-8 text-white', 'Dashboard'),
    errorSlot,
    checklist.el,
    mountBillingCard(),
    connectCard,
  )

  // An invite opened while signed out waits here until it is answered.
  const inviteCode = pendingFamilyInviteCode()
  if (inviteCode) {
    const inviteLink = el('a', ACCENT_BUTTON_CLASS + ' shrink-0', 'Review invite')
    inviteLink.href = `/family/join?code=${encodeURIComponent(inviteCode)}`
    container.append(el('div', 'rounded-2xl border border-glow-400/20 bg-shield-400/10 p-6 mb-6 flex items-center justify-between gap-4',
      el('p', 'text-sm text-white/70', 'You have an invite to join a family.'),
      inviteLink))
  }

  apiFetch('/family/').then(({ response, data }) => {
    if (!response.ok) {
      showError('Could not load your settings. Please reload the page.')
      return
    }
    const canChange = data.role !== 'child'
    container.append(
      createFilterSettingsCard({ canChange }),
      createInstalledPluginsCard({}),
    )
  })

  return {
    el: container,
    cleanup() {
      window.removeEventListener('message', handleExtensionMessage)
      clearTimeout(extensionAnswerTimer)
      stopDetectingExtension()
      checklist.cleanup()
    },
  }
}
