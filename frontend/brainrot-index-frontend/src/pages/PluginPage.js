// One plugin in the store: what it does, its rubric, recent results from the
// shared cache, reviews, and the reader's own rating. Its author also
// publishes new rubric versions here. Anyone can report it to the admin.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { createTryRubricBox } from '../components/TryRubricBox.js'
import { ACCENT_BUTTON_CLASS, CARD_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS, SELECT_CLASS } from '../components/styles.js'
import { createInstallButton, installSummary, ratingSummary } from './StorePage.js'
import { MAX_RUBRIC_CHARACTERS, RUBRIC_HELP } from './PublishPluginPage.js'

const PLATFORM_NAMES = { reddit: 'Reddit', x: 'X' }

function createButton(className, text) {
  const button = el('button', className, text)
  button.type = 'button'
  return button
}

function cardTitle(text) {
  return el('h2', 'text-lg font-semibold text-white mb-4', text)
}

export function mountPluginPage({ slug }) {
  let errorSlot = el('div')
  function showError(message) {
    const next = createErrorBanner(message)
    errorSlot.replaceWith(next)
    errorSlot = next
  }

  const storeLink = el('a', 'text-sm text-glow-400 hover:text-glow-300', 'Back to the store')
  storeLink.href = '/store'
  const content = el('div', '', el('p', 'text-sm text-white/50', 'Loading...'))
  const container = el('div', 'max-w-3xl mx-auto px-4 py-12', storeLink, errorSlot, content)

  function createHeader(plugin, isChild) {
    const stats = el('p', 'text-xs text-white/40', `${installSummary(plugin)} - ${ratingSummary(plugin)}`)
    let action = ''
    if (!isChild && (plugin.is_listed || plugin.installed)) {
      action = createInstallButton(plugin, showError)
      action.addEventListener('install-changed', () => load())
    }
    return el('div', 'mt-2 mb-8',
      el('div', 'flex flex-col sm:flex-row sm:items-start justify-between gap-4',
        el('div', 'min-w-0',
          el('h1', 'text-3xl font-bold text-white', plugin.name),
          el('p', 'text-sm text-white/40 mt-1', `by ${plugin.author_name}`)),
        action),
      el('p', 'text-white/70 mt-4', plugin.description),
      el('div', 'mt-2', stats),
      plugin.is_listed ? '' : el('p', 'mt-4 text-sm text-amber-400',
        'This plugin was removed from the store. It keeps running for people who already installed it.'))
  }

  function createRubricCard(plugin) {
    return el('div', CARD_CLASS,
      cardTitle(`Rubric, version ${plugin.version}`),
      el('p', 'text-xs text-white/40 mb-3',
        'The model reads this for every post and scores it from 0 to 100. '
        + `New installs filter posts scoring ${plugin.default_threshold} or more.`),
      el('pre', 'whitespace-pre-wrap break-words text-xs text-white/80 font-mono bg-black/30 rounded-lg p-4 max-h-96 overflow-y-auto', plugin.rubric))
  }

  function createSamplesCard(plugin) {
    const samples = plugin.samples.map((sample) => el('div', 'py-3 border-t border-white/10 first:border-t-0 text-sm',
      el('div', 'flex items-center justify-between gap-4 mb-1',
        el('span', 'text-xs text-white/40', PLATFORM_NAMES[sample.platform] || sample.platform),
        el('span', sample.score >= plugin.default_threshold ? 'text-xs text-glow-300' : 'text-xs text-white/50',
          `Score ${sample.score}, ${sample.label}`)),
      el('p', 'text-white/80 break-words', sample.text || '(no text)'),
      el('p', 'text-white/50 mt-1', sample.reasoning)))
    return el('div', CARD_CLASS,
      cardTitle('Recent results'),
      samples.length > 0 ? el('div', '', ...samples) : el('p', 'text-sm text-white/50', 'No posts have been scored with this version yet.'))
  }

  function createRatingForm(plugin) {
    const starsSelect = el('select', SELECT_CLASS)
    for (const stars of [5, 4, 3, 2, 1]) {
      const option = el('option', '', `${stars} out of 5`)
      option.value = String(stars)
      starsSelect.appendChild(option)
    }
    starsSelect.value = String(plugin.my_rating?.stars || 5)
    starsSelect.setAttribute('aria-label', 'Your rating')

    const reviewBox = el('textarea', INPUT_CLASS + ' h-20')
    reviewBox.maxLength = 500
    reviewBox.placeholder = 'A short review (optional)'
    reviewBox.value = plugin.my_rating?.review || ''
    reviewBox.setAttribute('aria-label', 'Your review')

    const status = el('span', 'text-xs text-white/50')
    const saveButton = createButton(ACCENT_BUTTON_CLASS, plugin.my_rating ? 'Update rating' : 'Save rating')
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true
      const { response, data } = await apiFetch(`/store/plugins/${plugin.slug}/rating/`, {
        method: 'PUT',
        body: { stars: Number(starsSelect.value), review: reviewBox.value.trim() },
      })
      saveButton.disabled = false
      if (!response.ok) {
        showError(errorMessageFrom(data, 'Could not save your rating. Please try again.'))
        return
      }
      showError('')
      load()
    })

    return el('div', 'flex flex-col gap-3 mb-6',
      el('p', LABEL_CLASS, 'Your rating'),
      starsSelect,
      reviewBox,
      el('div', 'flex items-center justify-end gap-3', status, saveButton))
  }

  function createReviewsCard(plugin, isChild) {
    let ratingArea = ''
    if (!isChild) {
      ratingArea = plugin.installed
        ? createRatingForm(plugin)
        : el('p', 'text-sm text-white/50 mb-6', 'Install this plugin to rate it.')
    }
    const reviews = plugin.reviews.map((review) => el('div', 'py-3 border-t border-white/10 first:border-t-0 text-sm',
      el('p', 'text-xs text-white/40 mb-1', `${review.stars} out of 5 - ${review.date}`),
      el('p', 'text-white/80 break-words', review.review)))
    return el('div', CARD_CLASS,
      cardTitle('Ratings and reviews'),
      ratingArea,
      reviews.length > 0 ? el('div', '', ...reviews) : el('p', 'text-sm text-white/50', 'No reviews yet.'))
  }

  function createNewVersionCard(plugin) {
    const rubricBox = el('textarea', INPUT_CLASS + ' h-64 font-mono text-xs')
    rubricBox.maxLength = MAX_RUBRIC_CHARACTERS
    rubricBox.value = plugin.rubric
    rubricBox.setAttribute('aria-label', 'New rubric')

    const publishButton = createButton(PRIMARY_BUTTON_CLASS, `Publish version ${plugin.version + 1}`)
    publishButton.addEventListener('click', async () => {
      publishButton.disabled = true
      const { response, data } = await apiFetch(`/store/plugins/${plugin.slug}/versions/`, {
        method: 'POST',
        body: { rubric: rubricBox.value },
      })
      publishButton.disabled = false
      if (!response.ok) {
        showError(errorMessageFrom(data, 'Could not publish the new version. Please try again.'))
        window.scrollTo(0, 0)
        return
      }
      showError('')
      load()
    })

    return el('div', CARD_CLASS + ' flex flex-col gap-4',
      el('div', '',
        el('h2', 'text-lg font-semibold text-white mb-1', 'Publish a new version'),
        el('p', 'text-sm text-white/60',
          'You wrote this plugin. A new version replaces the rubric for everyone who installed it; earlier versions and their results are kept.')),
      rubricBox,
      el('p', 'text-xs text-white/40', RUBRIC_HELP),
      createTryRubricBox(() => rubricBox.value),
      el('div', 'flex justify-end', publishButton))
  }

  function createReportArea(plugin) {
    const reasonBox = el('textarea', INPUT_CLASS + ' h-20')
    reasonBox.maxLength = 500
    reasonBox.placeholder = 'What is wrong with this plugin?'
    reasonBox.setAttribute('aria-label', 'Reason for the report')
    const sendButton = createButton(ACCENT_BUTTON_CLASS, 'Send report')
    const form = el('div', 'hidden mt-3 flex-col gap-3', reasonBox, el('div', 'flex justify-end', sendButton))
    const area = el('div', 'text-sm')

    const toggleButton = createButton(QUIET_BUTTON_CLASS, 'Report this plugin')
    toggleButton.addEventListener('click', () => {
      form.classList.toggle('hidden')
      form.classList.toggle('flex')
    })
    sendButton.addEventListener('click', async () => {
      sendButton.disabled = true
      const { response, data } = await apiFetch(`/store/plugins/${plugin.slug}/report/`, {
        method: 'POST',
        body: { reason: reasonBox.value.trim() },
      })
      sendButton.disabled = false
      if (!response.ok) {
        showError(errorMessageFrom(data, 'Could not send the report. Please try again.'))
        return
      }
      showError('')
      area.replaceChildren(el('p', 'text-white/60', 'Thanks. The report was sent to the BrainRot Index admin.'))
    })

    area.append(toggleButton, form)
    return area
  }

  let isChild = false

  async function load() {
    const { response, data } = await apiFetch(`/store/plugins/${slug}/`)
    if (!response.ok) {
      content.replaceChildren(el('p', 'mt-8 text-white/60',
        response.status === 404 ? 'This plugin is not in the store.' : 'Could not load this plugin. Please reload the page.'))
      return
    }
    content.replaceChildren(
      createHeader(data, isChild),
      createRubricCard(data),
      createSamplesCard(data),
      createReviewsCard(data, isChild),
      data.is_author && !isChild ? createNewVersionCard(data) : '',
      createReportArea(data))
  }

  apiFetch('/family/').then(({ response, data }) => {
    isChild = response.ok && data.role === 'child'
    load()
  })

  return { el: container }
}
