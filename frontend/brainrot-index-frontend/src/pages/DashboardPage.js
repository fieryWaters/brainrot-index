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
import { detectExtension } from '../lib/extension.js'

// Messages exchanged with the extension's content script on this page.
export const TOKEN_MESSAGE_TYPE = 'brainrot-index-extension-token'
export const CONNECTED_MESSAGE_TYPE = 'brainrot-index-extension-connected'
export const EXTENSION_ANSWER_TIMEOUT_MS = 3000

export function mountDashboardPage() {
  const container = el('div', 'max-w-2xl mx-auto px-4 py-12')
  let errorSlot = el('div')

  function showError(message) {
    const next = createErrorBanner(message)
    errorSlot.replaceWith(next)
    errorSlot = next
  }

  // -- Connect extension --
  let extensionAnswerTimer = null
  const connectStatus = el('p', 'text-sm text-white/60')
  const connectButton = el('button', 'shrink-0 ' + ACCENT_BUTTON_CLASS, 'Connect extension')
  connectButton.type = 'button'
  connectButton.addEventListener('click', async () => {
    connectButton.disabled = true
    connectStatus.textContent = 'Connecting...'
    const { response, data } = await apiFetch('/extension/token/', { method: 'POST' })
    connectButton.disabled = false
    if (data.code === 'email_not_verified') {
      connectStatus.textContent = 'Verify your email first: open the link we emailed you, or send a new one from Account settings. Then press Connect extension again.'
      return
    }
    if (!response.ok) {
      connectStatus.textContent = 'Could not create a connection. Please try again.'
      return
    }
    window.postMessage({ type: TOKEN_MESSAGE_TYPE, token: data.token }, window.location.origin)
    clearTimeout(extensionAnswerTimer)
    extensionAnswerTimer = setTimeout(() => {
      connectStatus.textContent = 'The extension did not answer on this page. If you just installed or reloaded it, reload this page and press Connect extension again.'
    }, EXTENSION_ANSWER_TIMEOUT_MS)
  })

  function handleExtensionMessage(event) {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== CONNECTED_MESSAGE_TYPE) return
    clearTimeout(extensionAnswerTimer)
    connectStatus.textContent = 'Connected'
    checklist.refresh()
  }
  window.addEventListener('message', handleExtensionMessage)

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
  const stopDetectingExtension = detectExtension(() => {
    checklist.markExtensionInstalled()
    connectStatus.textContent = 'Link the extension in this browser to your account.'
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
