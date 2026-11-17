// The settings that decide what one person's feed filters: the master switch
// and mode, and their installed plugins. The dashboard shows them for the
// signed-in user (basePath ''), the family page for a member
// (basePath '/family/members/<id>'). Each card loads itself and saves every
// change immediately. A child sees them with every control disabled.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { createErrorBanner } from './ErrorBanner.js'
import { CARD_CLASS, QUIET_BUTTON_CLASS, SELECT_CLASS, ACCENT_BUTTON_CLASS } from './styles.js'

const SAVE_FAILED_MESSAGE = 'Could not save that change. Please try again.'
const MANAGED_BY_FAMILY_MESSAGE = "Your family's superadmin manages these settings."

export function thresholdDescription(threshold) {
  return `Filter posts that score ${threshold} or more out of 100`
}

function createCheckbox(checked, label, disabled) {
  const checkbox = el('input', 'w-4 h-4 accent-glow-400 disabled:opacity-60')
  checkbox.type = 'checkbox'
  checkbox.checked = checked
  checkbox.disabled = disabled
  checkbox.setAttribute('aria-label', label)
  return checkbox
}

function createSelect(options, value, label, disabled) {
  const select = el('select', SELECT_CLASS)
  for (const [optionValue, optionLabel] of options) {
    const option = el('option', '', optionLabel)
    option.value = optionValue
    select.appendChild(option)
  }
  select.value = value
  select.disabled = disabled
  select.setAttribute('aria-label', label)
  return select
}

// A card with a title and an error banner slot, filled in once its data loads.
function createLoadingCard(title) {
  const body = el('div', 'text-sm text-white/50', 'Loading...')
  let errorSlot = el('div')
  const card = el('div', CARD_CLASS, el('h2', 'text-lg font-semibold text-white mb-4', title), errorSlot, body)

  function showError(message) {
    const next = createErrorBanner(message)
    errorSlot.replaceWith(next)
    errorSlot = next
  }

  return { card, body, showError }
}

export function createFilterSettingsCard({ basePath = '', canChange }) {
  const endpoint = `${basePath}/settings/`
  const { card, body, showError } = createLoadingCard('Filtering')

  async function save(change) {
    const { response, data } = await apiFetch(endpoint, { method: 'PATCH', body: change })
    showError(response.ok ? '' : errorMessageFrom(data, SAVE_FAILED_MESSAGE))
  }

  function render(settings) {
    const locked = !canChange
    const enabledCheckbox = createCheckbox(settings.enabled, 'Filtering on', locked)
    enabledCheckbox.addEventListener('change', () => save({ enabled: enabledCheckbox.checked }))

    const modeSelect = createSelect([['adult', 'Adult'], ['child', 'Child']], settings.mode, 'Mode', locked)
    modeSelect.addEventListener('change', () => save({ mode: modeSelect.value }))

    const revealCheckbox = createCheckbox(settings.allow_reveal, 'Allow revealing filtered posts', locked)
    revealCheckbox.addEventListener('change', () => save({ allow_reveal: revealCheckbox.checked }))

    body.className = 'flex flex-col gap-4 text-sm'
    body.replaceChildren(
      locked ? el('p', 'text-white/50', MANAGED_BY_FAMILY_MESSAGE) : '',
      el('label', 'flex items-center justify-between gap-4',
        el('span', '', 'Filtering on'),
        enabledCheckbox),
      el('label', 'flex items-center justify-between gap-4',
        el('span', '',
          el('span', 'block', 'Mode'),
          el('span', 'block text-white/50',
            'Child mode blurs posts until they are checked and never lets them be revealed.')),
        modeSelect),
      el('label', 'flex items-center justify-between gap-4',
        el('span', '',
          el('span', 'block', 'Allow revealing filtered posts'),
          el('span', 'block text-white/50', 'Shows a button on a filtered post to see it anyway. Off in child mode.')),
        revealCheckbox),
    )
  }

  apiFetch(endpoint).then(({ response, data }) => {
    if (!response.ok) {
      body.textContent = ''
      showError('Could not load these settings. Please reload the page.')
      return
    }
    render(data)
  })

  return card
}

export function createInstalledPluginsCard({ basePath = '', title = 'My plugins', showAddPlugin = false, forChild = false }) {
  const endpoint = `${basePath}/plugins/`
  const { card, body, showError } = createLoadingCard(title)
  const enabledCount = el('p', 'text-xs text-white/40')

  let enabledLimit = 0
  let plugins = []

  function updateEnabledCount() {
    const count = plugins.filter((plugin) => plugin.enabled).length
    enabledCount.textContent = `${count} of ${enabledLimit} turned on. Each plugin checks every post, so at most ${enabledLimit} can be on at once.`
  }

  async function save(plugin, change) {
    const { response, data } = await apiFetch(`${endpoint}${plugin.slug}/`, { method: 'PATCH', body: change })
    showError(response.ok ? '' : errorMessageFrom(data, SAVE_FAILED_MESSAGE))
    if (response.ok) Object.assign(plugin, change)
    return response.ok
  }

  function createPluginRow(plugin, canChange) {
    const locked = !canChange
    const enabledCheckbox = createCheckbox(plugin.enabled, `${plugin.name} on`, locked)
    enabledCheckbox.addEventListener('change', async () => {
      const saved = await save(plugin, { enabled: enabledCheckbox.checked })
      if (!saved) enabledCheckbox.checked = plugin.enabled
      updateEnabledCount()
    })

    const thresholdLabel = el('span', 'text-white/70', thresholdDescription(plugin.threshold))
    const thresholdSlider = el('input', 'w-full accent-glow-400 disabled:opacity-60')
    thresholdSlider.type = 'range'
    thresholdSlider.min = '0'
    thresholdSlider.max = '100'
    thresholdSlider.value = String(plugin.threshold)
    thresholdSlider.disabled = locked
    thresholdSlider.setAttribute('aria-label', `${plugin.name} threshold`)
    thresholdSlider.addEventListener('input', () => {
      thresholdLabel.textContent = thresholdDescription(thresholdSlider.value)
    })
    thresholdSlider.addEventListener('change', () => save(plugin, { threshold: Number(thresholdSlider.value) }))

    const actionSelect = createSelect([['hide', 'Hide'], ['blur', 'Blur']], plugin.flagged_action, `${plugin.name} action`, locked)
    actionSelect.addEventListener('change', () => save(plugin, { flagged_action: actionSelect.value }))

    const nameLink = el('a', 'font-semibold text-white hover:text-glow-300', plugin.name)
    nameLink.href = `/store/${plugin.slug}`

    const uninstallButton = el('button', QUIET_BUTTON_CLASS, 'Uninstall')
    uninstallButton.type = 'button'
    uninstallButton.addEventListener('click', async () => {
      uninstallButton.disabled = true
      const { response, data } = await apiFetch(`${endpoint}${plugin.slug}/`, { method: 'DELETE' })
      if (!response.ok) {
        uninstallButton.disabled = false
        showError(errorMessageFrom(data, 'Could not uninstall that plugin. Please try again.'))
        return
      }
      load()
    })

    return el('div', 'py-4 border-t border-white/10 first:border-t-0 flex flex-col gap-3 text-sm',
      el('div', 'flex items-start justify-between gap-4',
        el('div', '',
          nameLink,
          el('p', 'text-white/50', plugin.description)),
        enabledCheckbox),
      el('div', 'flex flex-col gap-1',
        thresholdLabel,
        thresholdSlider,
        el('div', 'flex justify-between text-xs text-white/40',
          el('span', '', 'Stricter'),
          el('span', '', 'More lenient')),
        el('p', 'text-xs text-white/40',
          'The model scores every post from 0 to 100. Slide left to filter more posts, including borderline ones; slide right to filter only clear cases.')),
      el('div', 'flex items-center justify-between gap-4',
        el('label', 'flex items-center gap-3',
          el('span', '', 'Filtered posts'),
          actionSelect),
        canChange ? uninstallButton : ''))
  }

  async function createAddPluginRow() {
    const { response, data } = await apiFetch('/store/plugins/')
    if (!response.ok) return ''
    const installedSlugs = new Set(plugins.map((plugin) => plugin.slug))
    const available = data.plugins.filter((plugin) => !installedSlugs.has(plugin.slug))
    if (available.length === 0) return ''

    // For a child, the plugins suggested for children come first and are marked.
    const suggested = forChild ? available.filter((plugin) => plugin.suggested_for_children) : []
    const others = available.filter((plugin) => !suggested.includes(plugin))
    const options = [
      ...suggested.map((plugin) => [plugin.slug, `${plugin.name} (suggested for children)`]),
      ...others.map((plugin) => [plugin.slug, plugin.name]),
    ]
    const pluginSelect = createSelect(options, options[0][0], 'Plugin to add', false)
    const addButton = el('button', ACCENT_BUTTON_CLASS, 'Add')
    addButton.type = 'button'
    addButton.addEventListener('click', async () => {
      addButton.disabled = true
      const result = await apiFetch(endpoint, { method: 'POST', body: { slug: pluginSelect.value } })
      addButton.disabled = false
      if (!result.response.ok) {
        showError(errorMessageFrom(result.data, 'Could not add that plugin. Please try again.'))
        return
      }
      load()
    })
    const suggestion = suggested.length > 0
      ? el('p', 'text-xs text-white/50', `Suggested for children: ${suggested.map((plugin) => plugin.name).join(', ')}.`)
      : ''
    return el('div', 'pt-4 border-t border-white/10 flex flex-col gap-2 text-sm',
      el('div', 'flex flex-wrap items-center gap-3',
        el('span', 'text-white/70', 'Add a plugin'), pluginSelect, addButton),
      suggestion)
  }

  async function load() {
    const { response, data } = await apiFetch(endpoint)
    if (!response.ok) {
      body.textContent = ''
      showError('Could not load these plugins. Please reload the page.')
      return
    }
    showError('')
    plugins = data.plugins
    enabledLimit = data.enabled_limit
    updateEnabledCount()

    const storeLink = el('a', 'text-glow-400 hover:text-glow-300', 'Browse the plugin store')
    storeLink.href = '/store'

    const rows = plugins.length > 0
      ? plugins.map((plugin) => createPluginRow(plugin, data.can_change))
      : [el('p', 'py-4 text-white/50', 'No plugins installed, so nothing is filtered.')]

    body.className = 'flex flex-col text-sm'
    body.replaceChildren(
      data.can_change ? enabledCount : el('p', 'text-white/50 mb-2', MANAGED_BY_FAMILY_MESSAGE),
      ...rows,
      showAddPlugin && data.can_change ? await createAddPluginRow() : '',
      basePath === '' && data.can_change ? el('p', 'pt-4 border-t border-white/10', storeLink) : '',
    )
  }

  load()
  return card
}
