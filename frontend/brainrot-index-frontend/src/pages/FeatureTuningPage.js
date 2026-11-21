// The owner's page for feature set drafts. A draft defines a few features of
// a post, each rated 0 to 10 by levels written from least to most, and the
// filters composed of them: a product of features, or a weighted sum, scaled
// to 0 to 100, with a cutoff. One experiment rates each post once and
// measures every filter on its own test set beside its live version.
// /tuning/features starts a draft from the saved feature set;
// /tuning/features/<id> shows an experiment. Each filter's cutoff can be
// moved there: the counts and marks are recomputed from the stored ratings,
// with no model call. Nothing here changes live filtering.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { navigate } from '../lib/router.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { ACCENT_BUTTON_CLASS, CARD_CLASS, INPUT_CLASS, LABEL_CLASS, QUIET_BUTTON_CLASS, SELECT_CLASS } from '../components/styles.js'
import {
  FAILED_CLASS,
  RIGHT_CLASS,
  SMALL_BUTTON_CLASS,
  WRONG_CLASS,
  costText,
  countsText,
  createHeader,
  createLabelControls,
  createOpenedPost,
  createPostRow,
  decisionWord,
  formatDateTime,
  refusalText,
} from './TuningPage.js'

const POLL_MILLISECONDS = 2000
const FORM_NAMES = { product: 'Product', weighted_sum: 'Weighted sum' }
const VIDEO_NOTE = "Drafts rate a post's text, images and transcript only. Production's Brainrot watches videos; a draft rates a video post on its text, thumbnail and transcript."

// -- Deciding from stored ratings --

function levelPoint(index, levelCount) {
  return (10 * index) / (levelCount - 1)
}

function pointText(point) {
  return Number.isInteger(point) ? String(point) : point.toFixed(1)
}

function draftFlags(result, slug, cutoff) {
  return !result.failed && result.filter_scores[slug] >= cutoff
}

function liveFlags(result, slug, experiment) {
  const answer = result.live[slug]
  return !answer.failed && answer.score >= experiment.live[slug].threshold
}

// Whether every filter whose test set holds the post decides it as it should, at the chosen cutoffs.
function isRight(result, cutoffs) {
  if (result.failed) return false
  return Object.keys(result.expected).every((slug) => draftFlags(result, slug, cutoffs[slug]) === result.expected[slug])
}

export function filterCounts(results, slug, cutoff, experiment) {
  const draft = { right: 0, missed: 0, wrongly_flagged: 0, failed: 0 }
  const live = { right: 0, missed: 0, wrongly_flagged: 0, failed: 0 }
  let cases = 0
  const count = (counts, flagged, shouldFlag) => {
    if (flagged === shouldFlag) counts.right += 1
    else if (shouldFlag) counts.missed += 1
    else counts.wrongly_flagged += 1
  }
  for (const result of results) {
    if (!(slug in result.expected)) continue
    cases += 1
    if (result.failed) draft.failed += 1
    else count(draft, draftFlags(result, slug, cutoff), result.expected[slug])
    if (result.live[slug].failed) live.failed += 1
    else count(live, liveFlags(result, slug, experiment), result.expected[slug])
  }
  return { cases, draft, live }
}

// -- The draft editor --

// "pull, emptiness" for a product; "hostility*10, humor*-6" for a weighted sum.
export function termsText(filter) {
  if (filter.form === 'product') return filter.features.join(', ')
  return Object.entries(filter.weights).map(([name, weight]) => `${name}*${weight}`).join(', ')
}

// The filter as the server takes it, or a sentence saying what is wrong with its terms.
export function filterFromTerms(plugin, form, terms, cutoff) {
  const parts = terms.split(',').map((part) => part.trim()).filter((part) => part !== '')
  if (form === 'product') return { plugin, form, features: parts, cutoff }
  const weights = {}
  for (const part of parts) {
    const [name, weight] = part.split('*').map((piece) => piece.trim())
    if (!name || weight === undefined || Number.isNaN(Number(weight))) {
      return `${plugin}: write each term of a weighted sum as feature*multiplier, such as hostility*10.`
    }
    weights[name] = Number(weight)
  }
  return { plugin, form, weights, cutoff }
}

function smallButton(text, onClick) {
  const button = el('button', SMALL_BUTTON_CLASS, text)
  button.type = 'button'
  button.addEventListener('click', onClick)
  return button
}

function textBox(value, label, className, onInput) {
  const box = el('textarea', `${INPUT_CLASS} ${className}`)
  box.value = value
  box.setAttribute('aria-label', label)
  box.addEventListener('input', () => onInput(box.value))
  return box
}

function textInput(value, label, className, onInput) {
  const input = el('input', `${INPUT_CLASS} ${className}`)
  input.value = value
  input.setAttribute('aria-label', label)
  input.addEventListener('input', () => onInput(input.value))
  return input
}

// One feature: its name, what it measures, and its levels from least to most, each with up to two examples.
function createFeatureEditor(feature, onRemove) {
  const levelsSlot = el('div', 'mt-2 space-y-2')
  function renderLevels() {
    levelsSlot.replaceChildren(...feature.levels.map((level, index) => el('div', 'grid gap-2 sm:grid-cols-[3.5rem_minmax(0,3fr)_minmax(0,2fr)_auto] items-start',
      el('span', 'pt-2 text-xs text-white/50', `at ${pointText(levelPoint(index, feature.levels.length))}`),
      textBox(level.text, 'Level description', 'h-14 text-xs', (value) => { level.text = value }),
      textBox(level.examples.join('\n'), 'Level examples, one per line', 'h-14 text-xs', (value) => {
        level.examples = value.split('\n').map((line) => line.trim()).filter((line) => line !== '')
      }),
      smallButton('Remove', () => { feature.levels.splice(index, 1); renderLevels() }))))
  }
  renderLevels()
  return el('div', 'rounded-xl border border-white/10 p-3',
    el('div', 'flex gap-2 items-start',
      el('div', 'w-48 shrink-0', textInput(feature.name, 'Feature name', 'font-mono text-xs', (value) => { feature.name = value.trim() })),
      textBox(feature.description, 'Feature description', 'h-14 text-xs', (value) => { feature.description = value }),
      smallButton('Remove feature', onRemove)),
    el('p', 'mt-2 text-xs text-white/40', 'Levels, least to most, placed evenly from 0 to 10. Examples are invented, one per line, at most two.'),
    levelsSlot,
    el('div', 'mt-1', smallButton('Add level', () => { feature.levels.push({ text: '', examples: [] }); renderLevels() })))
}

// filterRow: { plugin, form, terms, cutoff }, the terms as typed.
function createFilterRow(filterRow, liveFilters, onRemove) {
  const pluginSelect = el('select', `${SELECT_CLASS} text-xs`)
  pluginSelect.setAttribute('aria-label', 'Live filter it replaces')
  for (const live of liveFilters) {
    const option = el('option', '', live.name)
    option.value = live.slug
    option.selected = live.slug === filterRow.plugin
    pluginSelect.appendChild(option)
  }
  pluginSelect.addEventListener('change', () => { filterRow.plugin = pluginSelect.value })
  const formSelect = el('select', `${SELECT_CLASS} text-xs`)
  formSelect.setAttribute('aria-label', 'Formula')
  for (const [form, name] of Object.entries(FORM_NAMES)) {
    const option = el('option', '', name)
    option.value = form
    option.selected = form === filterRow.form
    formSelect.appendChild(option)
  }
  formSelect.addEventListener('change', () => { filterRow.form = formSelect.value })
  const cutoffInput = textInput(String(filterRow.cutoff), 'Filter cutoff', 'w-20 text-xs', (value) => { filterRow.cutoff = Number(value) })
  cutoffInput.type = 'number'
  return el('tr', 'align-top',
    el('td', 'py-1 pr-2', pluginSelect),
    el('td', 'py-1 pr-2', formSelect),
    el('td', 'py-1 pr-2', textInput(filterRow.terms, 'Formula terms', 'font-mono text-xs', (value) => { filterRow.terms = value })),
    el('td', 'py-1 pr-2', cutoffInput),
    el('td', 'py-1', smallButton('Remove', onRemove)))
}

// draft: { features, filterRows, explain_every_case, started_from, started_from_feature_set }, edited in place.
function createDraftEditor(overview, draft, onRun) {
  const featuresSlot = el('div', 'space-y-3')
  function renderFeatures() {
    featuresSlot.replaceChildren(...draft.features.map((feature, index) =>
      createFeatureEditor(feature, () => { draft.features.splice(index, 1); renderFeatures() })))
  }
  renderFeatures()
  const addFeatureButton = el('button', QUIET_BUTTON_CLASS, 'Add feature')
  addFeatureButton.type = 'button'
  addFeatureButton.addEventListener('click', () => {
    draft.features.push({ name: '', description: '', levels: [{ text: '', examples: [] }, { text: '', examples: [] }] })
    renderFeatures()
  })

  const filtersBody = el('tbody', '')
  function renderFilters() {
    filtersBody.replaceChildren(...draft.filterRows.map((filterRow, index) =>
      createFilterRow(filterRow, overview.filters, () => { draft.filterRows.splice(index, 1); renderFilters() })))
  }
  renderFilters()
  const addFilterButton = el('button', QUIET_BUTTON_CLASS, 'Add filter')
  addFilterButton.type = 'button'
  addFilterButton.addEventListener('click', () => {
    draft.filterRows.push({ plugin: overview.filters[0].slug, form: 'product', terms: '', cutoff: 50 })
    renderFilters()
  })

  const explainBox = el('input', '')
  explainBox.type = 'checkbox'
  explainBox.checked = draft.explain_every_case
  explainBox.addEventListener('change', () => { draft.explain_every_case = explainBox.checked })

  const runButton = el('button', ACCENT_BUTTON_CLASS, 'Run')
  runButton.type = 'button'
  const runStatus = el('p', 'text-xs text-red-400')
  runButton.addEventListener('click', async () => {
    runButton.disabled = true
    runStatus.textContent = ''
    const error = await onRun()
    runButton.disabled = false
    if (error) runStatus.textContent = error
  })

  return el('div', '',
    el('p', LABEL_CLASS, 'Features'),
    el('p', 'mt-1 mb-2 text-xs text-white/50', 'The model rates every feature of a post in one call, as a whole number from 0 to 10. A name is lowercase letters, digits and underscores.'),
    featuresSlot,
    el('div', 'mt-2', addFeatureButton),
    el('p', `${LABEL_CLASS} mt-6`, 'Filters'),
    el('p', 'mt-1 text-xs text-white/50', 'A product multiplies its features, each as a fraction of 10, times 100: "pull, emptiness". A weighted sum adds each feature times its multiplier, kept within 0 to 100: "hostility*10, humor*-6". A post scoring at or above the cutoff is blocked.'),
    el('table', 'mt-1 w-full text-left text-xs text-white/70',
      el('thead', '', el('tr', 'text-white/40',
        el('th', 'pb-1 pr-2 font-medium', 'Replaces'),
        el('th', 'pb-1 pr-2 font-medium', 'Formula'),
        el('th', 'pb-1 pr-2 font-medium', 'Terms'),
        el('th', 'pb-1 pr-2 font-medium', 'Cutoff'),
        el('th', 'pb-1 font-medium', ''))),
      filtersBody),
    el('div', 'mt-1', addFilterButton),
    el('div', 'mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/70',
      el('label', 'flex items-center gap-2', explainBox, 'Explain every post'),
      runButton),
    runStatus)
}

// -- An experiment --

function ownerText(result) {
  if (result.owner.should_be === 'shown') return 'You: shown'
  return `You: blocked as ${result.owner.plugin}`
}

function scoresText(result, experiment) {
  if (result.failed) return 'no usable answer'
  return experiment.features.map((feature) => `${feature.name} ${result.scores[feature.name]}`).join(' · ')
}

// The filters the post is in the test set of that decide it wrongly: "brainrot 60/50 block".
function wrongFiltersText(result, cutoffs) {
  if (result.failed) return ''
  return Object.keys(result.expected)
    .filter((slug) => draftFlags(result, slug, cutoffs[slug]) !== result.expected[slug])
    .map((slug) => `${slug} ${result.filter_scores[slug]}/${cutoffs[slug]} ${decisionWord(draftFlags(result, slug, cutoffs[slug]))}`)
    .join(', ')
}

function createRatings(result, experiment) {
  if (result.failed) return el('p', `text-sm ${FAILED_CLASS}`, 'The model gave no usable answer.')
  return el('div', 'text-sm text-white/80',
    el('p', 'text-xs text-white/50', 'Ratings'),
    el('ul', 'mt-1 space-y-1', ...experiment.features.map((feature) => el('li', 'flex gap-2',
      el('span', 'w-24 shrink-0 font-mono text-xs text-white/60', feature.name),
      el('span', 'w-6 shrink-0 text-right font-semibold text-white', String(result.scores[feature.name])),
      el('span', 'text-white/70', result.reasons[feature.name] || '')))))
}

function createFilterDecisions(result, experiment, cutoffs) {
  const rows = Object.keys(result.expected).map((slug) => {
    const flags = draftFlags(result, slug, cutoffs[slug])
    const rightClass = !result.failed && flags === result.expected[slug] ? RIGHT_CLASS : WRONG_CLASS
    const live = result.live[slug]
    const liveText = live.failed ? 'failed' : `${decisionWord(liveFlags(result, slug, experiment))}, ${live.score}/${experiment.live[slug].threshold}`
    const draftText = result.failed ? 'failed' : `${decisionWord(flags)}, ${result.filter_scores[slug]}/${cutoffs[slug]}`
    return el('tr', 'border-t border-white/5',
      el('td', 'py-1 pr-3 font-mono', slug),
      el('td', 'py-1 pr-3', decisionWord(result.expected[slug])),
      el('td', `py-1 pr-3 ${rightClass}`, draftText),
      el('td', 'py-1 text-white/50', liveText))
  })
  return el('table', 'w-full text-left text-xs text-white/70',
    el('thead', '', el('tr', 'text-white/40',
      el('th', 'pb-1 pr-3 font-medium', 'Filter'),
      el('th', 'pb-1 pr-3 font-medium', 'Should'),
      el('th', 'pb-1 pr-3 font-medium', 'Draft'),
      el('th', 'pb-1 font-medium', 'Live'))),
    el('tbody', '', ...rows))
}

function createResultRow(result, experiment, cutoffs, liveFilters) {
  const right = isRight(result, cutoffs)
  let mark = el('span', `w-12 shrink-0 text-xs font-semibold ${WRONG_CLASS}`, 'wrong')
  let rowClass = 'border-l-2 border-l-red-400/70 bg-red-500/[0.06]'
  if (result.failed) {
    mark = el('span', `w-12 shrink-0 text-xs font-semibold ${FAILED_CLASS}`, 'failed')
    rowClass = 'border-l-2 border-l-amber-400/70'
  } else if (right) {
    mark = el('span', `w-12 shrink-0 text-xs font-semibold ${RIGHT_CLASS}`, 'right')
    rowClass = 'opacity-60 hover:opacity-100'
  }
  const labelPart = createLabelControls(result, liveFilters, null)
  return createPostRow(result, mark,
    [el('span', 'shrink-0 whitespace-nowrap text-white/70 sm:w-48 truncate', ownerText(result)),
      el('span', 'shrink-0 whitespace-nowrap text-xs text-white/50 sm:w-72 truncate', right ? scoresText(result, experiment) : wrongFiltersText(result, cutoffs))],
    rowClass,
    () => createOpenedPost(result, createRatings(result, experiment), createFilterDecisions(result, experiment, cutoffs), labelPart))
}

// view: { cutoffs: { slug: cutoff }, rightOpen }, kept while the page polls a running experiment.
function createExperimentCard(experiment, view, liveFilters) {
  const card = el('section', CARD_CLASS)
  const tokens = experiment.prompt_tokens + experiment.completion_tokens
  const startedFrom = experiment.started_from
    ? `experiment ${experiment.started_from}`
    : experiment.started_from_feature_set ? `feature set v${experiment.started_from_feature_set}` : 'scratch'
  card.appendChild(el('div', 'flex flex-wrap items-baseline justify-between gap-2',
    el('h2', 'text-lg font-semibold text-white', `Feature experiment ${experiment.id}`),
    el('span', 'text-xs text-white/40',
      `${formatDateTime(experiment.created_at)}, from ${startedFrom}. ${experiment.model} (${experiment.inference_source}), ` +
      `${tokens} tokens (${experiment.cached_prompt_tokens} read from cache), ${costText(experiment.cost)}.`)))
  if (experiment.status === 'failed') card.appendChild(createErrorBanner(`The run failed: ${experiment.error}`))
  if (experiment.status === 'pending' || experiment.status === 'running') {
    const total = experiment.total_cases
    card.appendChild(el('p', 'mt-3 text-sm text-white/70',
      total === null ? 'Waiting for the worker...' : `Rated ${experiment.judged_cases} of ${total} posts...`))
  }

  const countsBody = el('tbody', '')
  const listSlot = el('div', 'mt-4')
  function show() {
    countsBody.replaceChildren(...experiment.filters.map((filter) => {
      const slug = filter.plugin
      const cutoffInput = el('input', `${INPUT_CLASS} w-20 py-1 text-xs`)
      cutoffInput.type = 'number'
      cutoffInput.min = '0'
      cutoffInput.max = '100'
      cutoffInput.value = String(view.cutoffs[slug])
      cutoffInput.setAttribute('aria-label', `Cutoff for ${slug}`)
      cutoffInput.addEventListener('change', () => {
        view.cutoffs[slug] = Number(cutoffInput.value)
        show()
      })
      const formula = filter.form === 'product' ? filter.features.join(' x ') : termsText(filter)
      const counts = filterCounts(experiment.results, slug, view.cutoffs[slug], experiment)
      let countsCell = el('td', 'py-1 pr-3 text-white/30', '-')
      if (counts.cases > 0) {
        countsCell = el('td', 'py-1 pr-3',
          el('div', 'font-semibold text-white', `${counts.cases}: ${countsText(counts.draft)}`),
          el('div', 'text-white/40', `live: ${countsText(counts.live)}`))
      }
      return el('tr', 'border-t border-white/10 align-top',
        el('td', 'py-1 pr-3 font-mono', slug, el('div', 'font-sans text-white/40', formula)),
        el('td', 'py-1 pr-3', cutoffInput, el('div', 'text-white/40', `live v${experiment.live[slug].version}, ${experiment.live[slug].threshold}`)),
        countsCell)
    }))

    const wrong = experiment.results.filter((result) => !isRight(result, view.cutoffs))
    const right = experiment.results.filter((result) => isRight(result, view.cutoffs))
    let wrongPart = el('p', 'py-2 text-sm text-white/50', 'Every filter gets every one of these right.')
    if (wrong.length > 0) {
      wrongPart = el('div', 'overflow-hidden rounded-xl border border-white/10',
        ...wrong.map((result) => createResultRow(result, experiment, view.cutoffs, liveFilters)))
    }
    const rightPart = el('details', 'mt-3',
      el('summary', 'cursor-pointer text-sm text-white/50 hover:text-white/80', `${right.length} right for every filter`),
      el('div', 'mt-2 overflow-hidden rounded-xl border border-white/10',
        ...right.map((result) => createResultRow(result, experiment, view.cutoffs, liveFilters))))
    rightPart.open = view.rightOpen
    rightPart.addEventListener('toggle', () => { view.rightOpen = rightPart.open })
    listSlot.replaceChildren(wrongPart, right.length > 0 ? rightPart : '')
  }
  show()

  card.appendChild(el('div', 'mt-4 overflow-x-auto', el('table', 'w-full text-left text-xs text-white/70',
    el('thead', '', el('tr', 'text-white/40',
      el('th', 'pb-1 pr-3 font-medium', 'Filter'),
      el('th', 'pb-1 pr-3 font-medium', 'Cutoff'),
      el('th', 'pb-1 pr-3 font-medium', 'Your thumbs'))),
    countsBody)))
  card.appendChild(el('p', 'mt-1 text-xs text-white/40', 'Moving a cutoff recomputes the counts and marks from the stored ratings, without asking the model again.'))
  card.appendChild(el('details', 'mt-3',
    el('summary', 'cursor-pointer text-xs text-white/50 hover:text-white/80', 'The instructions the model was given'),
    el('pre', 'mt-2 whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs text-white/70', experiment.system_prompt)))
  card.appendChild(listSlot)
  return card
}

// -- Past experiments --

function filterRightText(experiment, filter) {
  const score = experiment.scores[filter.plugin]
  if (!score) return `${filter.plugin} -`
  return `${filter.plugin} ${score.draft.right}/${score.cases} (live ${score.live.right})`
}

function createExperimentsTable(experiments, shownId) {
  const rows = experiments.map((experiment) => {
    const link = el('a', 'text-glow-400 hover:text-glow-300', `Experiment ${experiment.id}`)
    link.href = `/tuning/features/${experiment.id}`
    return el('tr', `border-t border-white/10 align-top ${experiment.id === shownId ? 'bg-white/5' : ''}`,
      el('td', 'py-1 pr-3', link),
      el('td', 'py-1 pr-3 whitespace-nowrap', formatDateTime(experiment.created_at)),
      el('td', 'py-1 pr-3', experiment.status),
      el('td', 'py-1 pr-3', ...experiment.filters.map((filter) => el('div', 'whitespace-nowrap', filterRightText(experiment, filter)))),
      el('td', 'py-1 whitespace-nowrap', costText(experiment.cost)))
  })
  return el('div', 'overflow-x-auto', el('table', 'w-full text-left text-xs text-white/70',
    el('thead', '', el('tr', 'text-white/40',
      el('th', 'pb-1 pr-3 font-medium', ''),
      el('th', 'pb-1 pr-3 font-medium', 'When'),
      el('th', 'pb-1 pr-3 font-medium', 'Status'),
      el('th', 'pb-1 pr-3 font-medium', 'Thumbs right, by filter'),
      el('th', 'pb-1 font-medium', 'Cost'))),
    el('tbody', '', ...rows)))
}

// -- The page --

function draftFrom(source, startedFrom, startedFromFeatureSet) {
  return {
    features: structuredClone(source.features),
    filterRows: source.filters.map((filter) => ({ plugin: filter.plugin, form: filter.form, terms: termsText(filter), cutoff: filter.cutoff })),
    explain_every_case: Boolean(source.explain_every_case),
    started_from: startedFrom,
    started_from_feature_set: startedFromFeatureSet,
  }
}

export function mountFeatureTuningPage({ experimentId } = {}) {
  const content = el('div', '', el('p', 'text-sm text-white/50', 'Loading...'))
  const container = el('div', 'max-w-7xl mx-auto px-4 py-12', createHeader('Feature tuning'), content)
  const view = { cutoffs: null, rightOpen: false }
  let pollTimer = null
  let stopped = false

  async function load() {
    const { response, data } = await apiFetch('/tuning/features/')
    if (!response.ok) {
      content.replaceChildren(createErrorBanner(refusalText(response, data, 'The feature sets')))
      return
    }
    const overview = data
    let experiment = null
    if (experimentId) {
      const found = await apiFetch(`/tuning/feature-experiments/${experimentId}/`)
      if (!found.response.ok) {
        content.replaceChildren(createErrorBanner(refusalText(found.response, found.data, 'The experiment')))
        return
      }
      experiment = found.data
    }
    let draft
    if (experiment) draft = draftFrom(experiment, experiment.id, null)
    else if (overview.feature_set) draft = draftFrom(overview.feature_set, null, overview.feature_set.id)
    else draft = draftFrom({ features: [], filters: [] }, null, null)
    render(overview, draft, experiment)
  }

  function render(overview, draft, experiment) {
    async function run() {
      const filters = []
      for (const filterRow of draft.filterRows) {
        const filter = filterFromTerms(filterRow.plugin, filterRow.form, filterRow.terms, filterRow.cutoff)
        if (typeof filter === 'string') return filter
        filters.push(filter)
      }
      const body = {
        features: draft.features,
        filters,
        explain_every_case: draft.explain_every_case,
        started_from: draft.started_from,
        started_from_feature_set: draft.started_from_feature_set,
      }
      const created = await apiFetch('/tuning/feature-experiments/', { method: 'POST', body })
      if (!created.response.ok) return errorMessageFrom(created.data, `Not started: error ${created.response.status}.`)
      navigate(`/tuning/features/${created.data.id}`)
      return ''
    }

    const startSelect = el('select', SELECT_CLASS)
    startSelect.setAttribute('aria-label', 'Start from')
    if (overview.feature_set) {
      const savedOption = el('option', '', `Feature set v${overview.feature_set.version}`)
      savedOption.value = 'saved'
      startSelect.appendChild(savedOption)
    }
    for (const past of overview.experiments) {
      const option = el('option', '', `Experiment ${past.id}, ${formatDateTime(past.created_at)}`)
      option.value = String(past.id)
      option.selected = draft.started_from === past.id
      startSelect.appendChild(option)
    }
    startSelect.addEventListener('change', () => {
      if (startSelect.value === 'saved') navigate('/tuning/features')
      else navigate(`/tuning/features/${startSelect.value}`)
    })

    const editorCard = el('section', CARD_CLASS,
      el('label', 'mb-4 flex items-center gap-2 text-sm text-white/70', 'Start from', startSelect),
      createDraftEditor(overview, draft, run))
    editorCard.hidden = experiment !== null
    const editButton = el('button', ACCENT_BUTTON_CLASS, editorCard.hidden ? 'Edit draft' : 'Hide draft')
    editButton.type = 'button'
    editButton.addEventListener('click', () => {
      editorCard.hidden = !editorCard.hidden
      editButton.textContent = editorCard.hidden ? 'Edit draft' : 'Hide draft'
    })
    const thumbCounts = overview.filters.map((live) => `${live.slug} ${live.thumb_cases}`).join(', ')
    const toolbar = el('div', 'mb-4 flex flex-wrap items-center gap-3 text-sm text-white/70',
      el('span', 'text-xs text-white/40', `Thumbs in each filter's test set: ${thumbCounts}. ${overview.model} (${overview.inference_source}).`),
      el('span', 'flex-1'),
      editButton)

    const experimentSlot = el('div', '')
    const pastCard = el('section', CARD_CLASS,
      el('h2', 'text-lg font-semibold text-white mb-3', 'Feature experiments'),
      overview.experiments.length > 0
        ? createExperimentsTable(overview.experiments, experiment ? experiment.id : null)
        : el('p', 'text-sm text-white/50', 'None yet.'))
    content.replaceChildren(
      el('p', `mb-4 text-xs ${FAILED_CLASS}`, VIDEO_NOTE),
      toolbar, editorCard, experimentSlot, pastCard)
    if (experiment) {
      view.cutoffs = Object.fromEntries(experiment.filters.map((filter) => [filter.plugin, filter.cutoff]))
      showExperiment(experimentSlot, experiment, overview.filters)
    }
  }

  function showExperiment(slot, experiment, liveFilters) {
    slot.replaceChildren(createExperimentCard(experiment, view, liveFilters))
    if (experiment.status !== 'pending' && experiment.status !== 'running') return
    pollTimer = setTimeout(async () => {
      if (stopped) return
      const { response, data } = await apiFetch(`/tuning/feature-experiments/${experiment.id}/`)
      if (stopped || !response.ok) return
      showExperiment(slot, data, liveFilters)
    }, POLL_MILLISECONDS)
  }

  load()
  return {
    el: container,
    cleanup: () => {
      stopped = true
      clearTimeout(pollTimer)
    },
  }
}
