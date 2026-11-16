// Dashboard: connect the browser extension, the master switch and mode, and
// one row of settings per installed plugin. Every change saves immediately.

import { apiFetch } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { createErrorBanner } from '../components/ErrorBanner.js'

// Messages exchanged with the extension's content script on this page.
export const TOKEN_MESSAGE_TYPE = 'brainrot-index-extension-token'
export const CONNECTED_MESSAGE_TYPE = 'brainrot-index-extension-connected'
export const EXTENSION_ANSWER_TIMEOUT_MS = 3000

const CARD_CLASS = 'rounded-2xl border border-white/10 bg-black/30 p-6 mb-6'
const AMBER_BUTTON_CLASS = 'px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-colors disabled:opacity-60'
const SELECT_CLASS = 'px-3 py-1.5 rounded-lg bg-black/30 border border-white/10 text-white text-sm focus:border-amber-500 focus:outline-none'

function createCheckbox(checked, label) {
  const checkbox = el('input', 'w-4 h-4 accent-amber-500')
  checkbox.type = 'checkbox'
  checkbox.checked = checked
  checkbox.setAttribute('aria-label', label)
  return checkbox
}

function createSelect(options, value, label) {
  const select = el('select', SELECT_CLASS)
  for (const [optionValue, optionLabel] of options) {
    const option = el('option', '', optionLabel)
    option.value = optionValue
    select.appendChild(option)
  }
  select.value = value
  select.setAttribute('aria-label', label)
  return select
}

function thresholdDescription(threshold) {
  return `Filter posts that score ${threshold} or more out of 100`
}

export function mountDashboardPage() {
  const container = el('div', 'max-w-2xl mx-auto px-4 py-12')
  let errorSlot = el('div')

  function showError(message) {
    const next = createErrorBanner(message)
    errorSlot.replaceWith(next)
    errorSlot = next
  }

  async function save(endpoint, change) {
    const { response } = await apiFetch(endpoint, { method: 'PATCH', body: change })
    showError(response.ok ? '' : 'Could not save that change. Please try again.')
  }

  // -- Connect extension --
  let extensionAnswerTimer = null
  const connectStatus = el('p', 'text-sm text-white/60')
  const connectButton = el('button', 'shrink-0 ' + AMBER_BUTTON_CLASS, 'Connect extension')
  connectButton.type = 'button'
  connectButton.addEventListener('click', async () => {
    connectButton.disabled = true
    connectStatus.textContent = 'Connecting...'
    const { response, data } = await apiFetch('/extension/token/', { method: 'POST' })
    connectButton.disabled = false
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
  }
  window.addEventListener('message', handleExtensionMessage)

  const connectCard = el('div', CARD_CLASS,
    el('div', 'flex items-center justify-between gap-4',
      el('div', '',
        el('h2', 'text-lg font-semibold text-white mb-1', 'Browser extension'),
        connectStatus),
      connectButton))
  connectStatus.textContent = 'Link the extension in this browser to your account.'

  // -- Master switch and mode --
  function createSettingsCard(settings) {
    const enabledCheckbox = createCheckbox(settings.enabled, 'Filtering on')
    enabledCheckbox.addEventListener('change', () => save('/settings/', { enabled: enabledCheckbox.checked }))

    const modeSelect = createSelect([['adult', 'Adult'], ['child', 'Child']], settings.mode, 'Mode')
    modeSelect.addEventListener('change', () => save('/settings/', { mode: modeSelect.value }))

    return el('div', CARD_CLASS,
      el('h2', 'text-lg font-semibold text-white mb-4', 'Filtering'),
      el('div', 'flex flex-col gap-4 text-sm',
        el('label', 'flex items-center justify-between gap-4',
          el('span', '', 'Filtering on'),
          enabledCheckbox),
        el('label', 'flex items-center justify-between gap-4',
          el('span', '',
            el('span', 'block', 'Mode'),
            el('span', 'block text-white/50',
              'Child mode blurs posts until they are checked and never lets them be revealed.')),
          modeSelect)))
  }

  // -- One row per installed plugin --
  function createPluginRow(plugin) {
    const endpoint = `/plugins/${plugin.slug}/`

    const enabledCheckbox = createCheckbox(plugin.enabled, `${plugin.name} on`)
    enabledCheckbox.addEventListener('change', () => save(endpoint, { enabled: enabledCheckbox.checked }))

    const thresholdLabel = el('span', 'text-white/70', thresholdDescription(plugin.threshold))
    const thresholdSlider = el('input', 'w-full accent-amber-500')
    thresholdSlider.type = 'range'
    thresholdSlider.min = '0'
    thresholdSlider.max = '100'
    thresholdSlider.value = String(plugin.threshold)
    thresholdSlider.setAttribute('aria-label', `${plugin.name} threshold`)
    thresholdSlider.addEventListener('input', () => {
      thresholdLabel.textContent = thresholdDescription(thresholdSlider.value)
    })
    thresholdSlider.addEventListener('change', () => save(endpoint, { threshold: Number(thresholdSlider.value) }))

    const actionSelect = createSelect([['hide', 'Hide'], ['blur', 'Blur']], plugin.flagged_action, `${plugin.name} action`)
    actionSelect.addEventListener('change', () => save(endpoint, { flagged_action: actionSelect.value }))

    return el('div', 'py-4 border-t border-white/10 first:border-t-0 flex flex-col gap-3 text-sm',
      el('div', 'flex items-start justify-between gap-4',
        el('div', '',
          el('h3', 'font-semibold text-white', plugin.name),
          el('p', 'text-white/50', plugin.description)),
        enabledCheckbox),
      el('div', 'flex flex-col gap-1',
        thresholdLabel,
        thresholdSlider,
        el('div', 'flex justify-between text-xs text-white/40',
          el('span', '', 'Stricter'),
          el('span', '', 'More lenient'))),
      el('label', 'flex items-center justify-between gap-4',
        el('span', '', 'What to do with filtered posts'),
        actionSelect))
  }

  container.append(
    el('h1', 'text-3xl font-bold mb-8 text-white', 'Dashboard'),
    errorSlot,
    connectCard,
  )

  Promise.all([apiFetch('/settings/'), apiFetch('/plugins/')]).then(([settingsResult, pluginsResult]) => {
    if (!settingsResult.response.ok || !pluginsResult.response.ok) {
      showError('Could not load your settings. Please reload the page.')
      return
    }
    container.append(
      createSettingsCard(settingsResult.data),
      el('div', CARD_CLASS,
        el('h2', 'text-lg font-semibold text-white mb-2', 'Filters'),
        ...pluginsResult.data.plugins.map(createPluginRow)),
    )
  })

  return {
    el: container,
    cleanup() {
      window.removeEventListener('message', handleExtensionMessage)
      clearTimeout(extensionAnswerTimer)
    },
  }
}
