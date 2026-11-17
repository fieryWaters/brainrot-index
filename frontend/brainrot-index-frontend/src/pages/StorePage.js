// Plugin store: every listed plugin, searchable, with install counts and
// ratings, and an Install button. A plugin's own page has the rubric,
// sample results, reviews and rating.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { AMBER_BUTTON_CLASS, INPUT_CLASS, PRIMARY_BUTTON_CLASS } from '../components/styles.js'

export const SEARCH_DELAY_MS = 300

export function ratingSummary(plugin) {
  if (plugin.rating_count === 0) return 'No ratings yet'
  const ratings = plugin.rating_count === 1 ? 'rating' : 'ratings'
  return `${plugin.average_rating.toFixed(1)} out of 5 from ${plugin.rating_count} ${ratings}`
}

export function installSummary(plugin) {
  return plugin.install_count === 1 ? '1 install' : `${plugin.install_count} installs`
}

// Install or Uninstall for the signed-in user, kept in step with plugin.installed.
export function createInstallButton(plugin, showError) {
  const button = el('button', '')
  button.type = 'button'

  function render() {
    button.className = 'shrink-0 ' + (plugin.installed ? AMBER_BUTTON_CLASS : PRIMARY_BUTTON_CLASS)
    button.textContent = plugin.installed ? 'Uninstall' : 'Install'
  }

  button.addEventListener('click', async () => {
    button.disabled = true
    const { response, data } = plugin.installed
      ? await apiFetch(`/plugins/${plugin.slug}/`, { method: 'DELETE' })
      : await apiFetch('/plugins/', { method: 'POST', body: { slug: plugin.slug } })
    button.disabled = false
    if (!response.ok) {
      showError(errorMessageFrom(data, 'Could not change that plugin. Please try again.'))
      return
    }
    showError('')
    plugin.installed = !plugin.installed
    plugin.install_count += plugin.installed ? 1 : -1
    render()
    button.dispatchEvent(new CustomEvent('install-changed', { bubbles: true }))
  })

  render()
  return button
}

export function mountStorePage() {
  let errorSlot = el('div')
  function showError(message) {
    const next = createErrorBanner(message)
    errorSlot.replaceWith(next)
    errorSlot = next
  }

  const searchInput = el('input', INPUT_CLASS)
  searchInput.type = 'search'
  searchInput.placeholder = 'Search plugins'
  searchInput.setAttribute('aria-label', 'Search plugins')

  const publishLink = el('a', PRIMARY_BUTTON_CLASS + ' shrink-0 text-center', 'Publish a plugin')
  publishLink.href = '/store/publish'
  const actionsRow = el('div', 'flex flex-col sm:flex-row gap-3 mb-6', searchInput)
  const list = el('div', 'flex flex-col gap-4', el('p', 'text-sm text-white/50', 'Loading...'))

  const container = el('div', 'max-w-3xl mx-auto px-4 py-12',
    el('h1', 'text-3xl font-bold mb-2 text-white', 'Plugin store'),
    el('p', 'text-white/60 mb-8',
      'A plugin is a rubric the AI model uses to score every post you see. Install the ones you want; each one you turn on checks every post.'),
    errorSlot,
    actionsRow,
    list)

  let isChild = false

  function createPluginCard(plugin) {
    const nameLink = el('a', 'text-lg font-semibold text-white hover:text-amber-300', plugin.name)
    nameLink.href = `/store/${plugin.slug}`
    const detailsLink = el('a', 'text-sm text-amber-400 hover:text-amber-300', 'Rubric, samples and reviews')
    detailsLink.href = `/store/${plugin.slug}`

    const stats = el('p', 'text-xs text-white/40', `${installSummary(plugin)} - ${ratingSummary(plugin)}`)
    let action
    if (isChild) {
      action = plugin.installed ? el('span', 'shrink-0 text-sm text-emerald-400', 'Installed') : ''
    } else {
      action = createInstallButton(plugin, showError)
      action.addEventListener('install-changed', () => {
        stats.textContent = `${installSummary(plugin)} - ${ratingSummary(plugin)}`
      })
    }

    return el('div', 'rounded-2xl border border-white/10 bg-black/30 p-5 flex flex-col gap-2',
      el('div', 'flex items-start justify-between gap-4',
        el('div', 'min-w-0',
          nameLink,
          el('p', 'text-xs text-white/40', `by ${plugin.author_name}`)),
        action),
      el('p', 'text-sm text-white/70', plugin.description),
      el('div', 'flex flex-wrap items-center justify-between gap-2', stats, detailsLink))
  }

  let searchTimer = null
  let latestSearch = 0
  async function loadPlugins() {
    const query = searchInput.value.trim()
    const search = ++latestSearch
    const { response, data } = await apiFetch(`/store/plugins/${query ? `?q=${encodeURIComponent(query)}` : ''}`)
    if (search !== latestSearch) return
    if (!response.ok) {
      list.replaceChildren()
      showError(errorMessageFrom(data, 'Could not load the store. Please reload the page.'))
      return
    }
    showError('')
    if (data.plugins.length === 0) {
      list.replaceChildren(el('p', 'text-sm text-white/50',
        query ? `No plugins match "${query}".` : 'No plugins are listed yet.'))
      return
    }
    list.replaceChildren(...data.plugins.map(createPluginCard))
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(loadPlugins, SEARCH_DELAY_MS)
  })

  apiFetch('/family/').then(({ response, data }) => {
    isChild = response.ok && data.role === 'child'
    if (isChild) {
      actionsRow.before(el('p', 'text-sm text-white/50 mb-6',
        "Child accounts can look around; your family's superadmin installs plugins for you."))
    } else {
      actionsRow.append(publishLink)
    }
    loadPlugins()
  })

  return {
    el: container,
    cleanup() {
      clearTimeout(searchTimer)
    },
  }
}
