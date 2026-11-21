// The owner's tuning page: edit a draft of a filter's rubric (its text,
// criteria and cutoff) and run it on the owner's thumbs, and optionally the
// synthetic test set, beside the live version. The background worker judges
// each post with the production prompt and model; the page follows its
// progress. Every run is saved as an experiment: /tuning/<id> shows one, with
// its draft loaded for further editing, and /tuning/compare/<id>/<id> puts two
// side by side. The owner can also change or delete a thumbs from its row.
// Nothing here changes live filtering. The server refuses everyone but the
// owner (the account the admin lets in).

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { navigate } from '../lib/router.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { ACCENT_BUTTON_CLASS, CARD_CLASS, INPUT_CLASS, LABEL_CLASS, QUIET_BUTTON_CLASS, SELECT_CLASS } from '../components/styles.js'

const POLL_MILLISECONDS = 2000
const SMALL_BUTTON_CLASS = 'px-2 py-0.5 rounded text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-60'
const RIGHT_CLASS = 'text-glow-300'
const WRONG_CLASS = 'text-red-300'
const SOURCE_NAMES = { thumb: 'Thumbs', synthetic: 'Synthetic' }
const ROW_FILTERS = [['all', 'All'], ['wrong', 'Draft wrong'], ['changed', 'Changed from live']]
const TAB_CLASS = 'px-3 py-1 rounded-lg text-xs transition-colors'
const TAB_IDLE_CLASS = 'text-white/60 hover:text-white hover:bg-white/5'
const TAB_CHOSEN_CLASS = 'bg-shield-400/25 text-glow-300'

function formatDateTime(isoDate) {
  return new Date(isoDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function costText(cost) {
  if (cost === null) return 'cost not reported'
  return `$${cost.toFixed(4)}`
}

function flags(answer, threshold) {
  return !answer.failed && answer.score >= threshold
}

function isDraftWrong(result, experiment) {
  return flags(result.draft, experiment.threshold) !== result.should_flag
}

function isChangedFromLive(result, experiment) {
  return flags(result.draft, experiment.threshold) !== flags(result.live, experiment.live_threshold)
}

// "48 of 62 right (9 missed, 5 wrongly flagged)", and failures when there are any.
export function countsText(counts, cases) {
  let text = `${counts.right} of ${cases} right (${counts.missed} missed, ${counts.wrongly_flagged} wrongly flagged`
  if (counts.failed > 0) text += `, ${counts.failed} failed`
  return `${text})`
}

function maxScore(criteria) {
  return criteria.reduce((total, criterion) => total + Math.max(0, criterion.points), 0)
}

function experimentLink(id, text = `Experiment ${id}`) {
  const link = el('a', 'text-glow-400 hover:text-glow-300', text)
  link.href = `/tuning/${id}`
  return link
}

// -- The draft editor --

function createCriterionRow(criterion, onChange, onRemove) {
  const nameInput = el('input', `${INPUT_CLASS} font-mono text-xs`)
  nameInput.value = criterion.name
  nameInput.setAttribute('aria-label', 'Criterion name')
  const questionBox = el('textarea', `${INPUT_CLASS} h-16 text-xs`)
  questionBox.value = criterion.question
  questionBox.setAttribute('aria-label', 'Criterion question')
  const pointsInput = el('input', `${INPUT_CLASS} text-xs`)
  pointsInput.type = 'number'
  pointsInput.value = String(criterion.points)
  pointsInput.setAttribute('aria-label', 'Criterion points')
  const removeButton = el('button', SMALL_BUTTON_CLASS, 'Remove')
  removeButton.type = 'button'

  nameInput.addEventListener('input', () => { criterion.name = nameInput.value.trim(); onChange() })
  questionBox.addEventListener('input', () => { criterion.question = questionBox.value; onChange() })
  pointsInput.addEventListener('input', () => { criterion.points = Number(pointsInput.value); onChange() })
  removeButton.addEventListener('click', onRemove)

  return el('tr', 'align-top',
    el('td', 'py-1 pr-2 w-48', nameInput),
    el('td', 'py-1 pr-2', questionBox),
    el('td', 'py-1 pr-2 w-24', pointsInput),
    el('td', 'py-1', removeButton))
}

// draft: { rubric_prompt, criteria, threshold, include_synthetic, explain_every_case, started_from }, edited in place.
function createDraftEditor(filter, draft, lastExperiment, onRun) {
  const rubricBox = el('textarea', `${INPUT_CLASS} h-64 font-mono text-xs`)
  rubricBox.value = draft.rubric_prompt
  rubricBox.setAttribute('aria-label', 'Rubric text')
  rubricBox.addEventListener('input', () => { draft.rubric_prompt = rubricBox.value })

  const maxScoreText = el('p', 'mt-1 text-xs text-white/50')
  const criteriaBody = el('tbody', '')
  function renderCriteria() {
    criteriaBody.replaceChildren(...draft.criteria.map((criterion, index) => createCriterionRow(
      criterion, updateMaxScore, () => { draft.criteria.splice(index, 1); renderCriteria() })))
    updateMaxScore()
  }
  function updateMaxScore() {
    maxScoreText.textContent = `A post meeting every criterion with positive points scores ${maxScore(draft.criteria)} (scores stay within 0 to 100).`
  }
  const addButton = el('button', QUIET_BUTTON_CLASS, 'Add criterion')
  addButton.type = 'button'
  addButton.addEventListener('click', () => {
    draft.criteria.push({ name: '', question: '', points: 0 })
    renderCriteria()
  })
  renderCriteria()

  const thresholdInput = el('input', `${INPUT_CLASS} w-24`)
  thresholdInput.type = 'number'
  thresholdInput.min = '0'
  thresholdInput.max = '100'
  thresholdInput.value = String(draft.threshold)
  thresholdInput.setAttribute('aria-label', 'Cutoff')
  thresholdInput.addEventListener('input', () => { draft.threshold = Number(thresholdInput.value) })

  const syntheticBox = el('input', '')
  syntheticBox.type = 'checkbox'
  syntheticBox.checked = draft.include_synthetic && filter.synthetic_cases > 0
  syntheticBox.disabled = filter.synthetic_cases === 0
  syntheticBox.addEventListener('change', () => { draft.include_synthetic = syntheticBox.checked })
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

  let lastCostText = 'No earlier experiment on this filter.'
  if (lastExperiment) {
    lastCostText = `The last experiment judged ${lastExperiment.judged_cases} posts: ${lastExperiment.prompt_tokens + lastExperiment.completion_tokens} tokens, ${costText(lastExperiment.cost)}.`
  }
  const syntheticText = filter.synthetic_cases > 0
    ? `Also judge the synthetic test set (${filter.synthetic_cases} examples)`
    : 'The synthetic test set has no examples for this filter'

  return el('div', '',
    el('p', LABEL_CLASS, 'Rubric text'),
    el('div', 'mt-1', rubricBox),
    el('p', `${LABEL_CLASS} mt-4`, 'Criteria'),
    el('p', 'mt-1 text-xs text-white/50', 'The model answers yes or no to each question; the score adds the points of those met. A name is lowercase letters, digits and underscores.'),
    el('table', 'mt-1 w-full text-left text-xs text-white/70',
      el('thead', '', el('tr', 'text-white/40',
        el('th', 'pb-1 pr-2 font-medium', 'Name'),
        el('th', 'pb-1 pr-2 font-medium', 'Question'),
        el('th', 'pb-1 pr-2 font-medium', 'Points'),
        el('th', 'pb-1 font-medium', ''))),
      criteriaBody),
    maxScoreText,
    el('div', 'mt-1', addButton),
    el('div', 'mt-4 flex flex-wrap items-center gap-4 text-sm text-white/70',
      el('label', 'flex items-center gap-2', 'Cutoff', thresholdInput),
      el('label', 'flex items-center gap-2', syntheticBox, syntheticText),
      el('label', 'flex items-center gap-2', explainBox, 'Explain every post (by default only the posts the draft gets wrong or decides differently)')),
    el('div', 'mt-4 flex flex-wrap items-center gap-4',
      runButton,
      el('p', 'text-xs text-white/50', `Runs on ${filter.thumb_cases} of your thumbs with the production prompt and model. ${lastCostText}`)),
    runStatus)
}

// -- Results --

function createScoresTable(experiment) {
  const rows = []
  for (const source of ['thumb', 'synthetic']) {
    const score = experiment.scores[source]
    if (!score) continue
    rows.push(el('tr', 'border-t border-white/10',
      el('td', 'py-1 pr-4 text-white/90', `${SOURCE_NAMES[source]} (${score.cases})`),
      el('td', 'py-1 pr-4', `Draft, cutoff ${experiment.threshold}: ${countsText(score.draft, score.cases)}`),
      el('td', 'py-1', `Live v${experiment.live_version}, cutoff ${experiment.live_threshold}: ${countsText(score.live, score.cases)}`)))
  }
  return el('table', 'mt-3 text-left text-sm text-white/70', el('tbody', '', ...rows))
}

function createDraftSummary(experiment) {
  const liveByName = Object.fromEntries(experiment.live_criteria.map((criterion) => [criterion.name, criterion]))
  const rows = experiment.criteria.map((criterion) => {
    const live = liveByName[criterion.name]
    let change = 'new'
    if (live) {
      change = live.points === criterion.points && live.question === criterion.question ? '' : `changed (live: ${live.points})`
    }
    return el('tr', 'border-t border-white/10 align-top',
      el('td', 'py-1 pr-3 font-mono text-white/90', criterion.name),
      el('td', 'py-1 pr-3 whitespace-nowrap', String(criterion.points)),
      el('td', 'py-1 pr-3 text-white/60', criterion.question),
      el('td', 'py-1 whitespace-nowrap text-amber-300', change))
  })
  const draftNames = new Set(experiment.criteria.map((criterion) => criterion.name))
  for (const criterion of experiment.live_criteria) {
    if (draftNames.has(criterion.name)) continue
    rows.push(el('tr', 'border-t border-white/10 align-top text-white/40',
      el('td', 'py-1 pr-3 font-mono line-through', criterion.name),
      el('td', 'py-1 pr-3', String(criterion.points)),
      el('td', 'py-1 pr-3', criterion.question),
      el('td', 'py-1 text-amber-300', 'removed')))
  }
  const rubricChanged = experiment.rubric_prompt !== experiment.live_rubric_prompt
  return el('details', 'mt-3 text-xs text-white/70',
    el('summary', 'cursor-pointer text-white/60',
      `Draft: ${experiment.criteria.length} criteria, cutoff ${experiment.threshold}, rubric text ${rubricChanged ? 'changed from live' : 'as live'}`),
    el('table', 'mt-2 w-full text-left', el('tbody', '', ...rows)),
    el('pre', 'mt-2 p-3 rounded-lg bg-black/30 whitespace-pre-wrap font-mono text-white/70', experiment.rubric_prompt))
}

function decisionCell(answer, threshold, shouldFlag, note) {
  if (answer.failed) {
    return el('td', 'py-2 pr-3 whitespace-nowrap text-red-400', 'failed')
  }
  const flagged = answer.score >= threshold
  const rightness = flagged === shouldFlag ? RIGHT_CLASS : WRONG_CLASS
  return el('td', 'py-2 pr-3',
    el('div', `whitespace-nowrap ${rightness}`, `${answer.score}/${threshold} ${flagged ? 'flag' : 'allow'}`),
    el('div', 'text-white/50 font-mono', answer.criteria_met.join(', ')),
    note ? el('div', 'text-white/40', note) : '')
}

function createThumbControls(result, owner) {
  const status = el('span', 'text-white/40')
  const flipButton = el('button', SMALL_BUTTON_CLASS, owner.verdict === 'right' ? 'Make it thumbs down' : 'Make it thumbs up')
  flipButton.type = 'button'
  const noteInput = el('input', `${INPUT_CLASS} text-xs py-1`)
  noteInput.value = owner.details
  noteInput.placeholder = 'Note'
  noteInput.setAttribute('aria-label', 'Thumbs note')
  const saveNoteButton = el('button', SMALL_BUTTON_CLASS, 'Save note')
  saveNoteButton.type = 'button'
  const deleteButton = el('button', `${SMALL_BUTTON_CLASS} text-red-300`, 'Delete')
  deleteButton.type = 'button'
  let verdict = owner.verdict

  async function change(method, body, doneText) {
    status.textContent = ''
    const { response, data } = await apiFetch(`/tuning/thumbs/${result.judgment_id}/`, { method, body })
    if (!response.ok) {
      status.textContent = errorMessageFrom(data, `Not saved: error ${response.status}.`)
      return null
    }
    status.textContent = doneText
    return data
  }
  flipButton.addEventListener('click', async () => {
    const next = verdict === 'right' ? 'wrong' : 'right'
    if (await change('PATCH', { verdict: next }, `Now thumbs ${next === 'right' ? 'up' : 'down'}; the next run uses it.`)) {
      verdict = next
      flipButton.textContent = verdict === 'right' ? 'Make it thumbs down' : 'Make it thumbs up'
    }
  })
  saveNoteButton.addEventListener('click', () => change('PATCH', { details: noteInput.value.trim() }, 'Note saved.'))
  deleteButton.addEventListener('click', async () => {
    if (!window.confirm('Delete this thumbs for good? It leaves the labeled set; experiments keep their copy.')) return
    if (await change('DELETE', undefined, 'Deleted.')) {
      flipButton.disabled = true
      saveNoteButton.disabled = true
      deleteButton.disabled = true
    }
  })
  return el('div', 'mt-2 flex flex-col gap-1',
    el('div', 'flex gap-1', noteInput, saveNoteButton),
    el('div', 'flex flex-wrap gap-1', flipButton, deleteButton),
    status)
}

function ownerCell(result) {
  const expected = el('div', 'font-semibold text-white/90', result.should_flag ? 'Should flag' : 'Should allow')
  const owner = result.owner
  if (result.source === 'synthetic') {
    return el('td', 'py-2 pr-3 w-64', expected, el('div', 'text-white/50', owner.why))
  }
  const verdictText = `Thumbs ${owner.verdict === 'right' ? 'up' : 'down'} on a post ${owner.shown_action === 'allow' ? 'shown' : 'hidden'}`
  const cell = el('td', 'py-2 pr-3 w-64', expected, el('div', 'text-white/50', verdictText))
  if (owner.details) cell.appendChild(el('div', 'text-white/80 whitespace-pre-wrap', owner.details))
  if (result.judgment_id !== null) {
    cell.appendChild(createThumbControls(result, owner))
  } else {
    cell.appendChild(el('div', 'text-white/40', 'This thumbs was deleted.'))
  }
  return cell
}

function postCell(result) {
  let idPart = el('span', 'text-white/50', result.case_id)
  if (result.source === 'thumb') {
    idPart = el('a', 'text-glow-400 hover:text-glow-300', result.case_id)
    idPart.href = `/inbox/${result.case_id}`
  }
  const description = el('p', 'mt-1 whitespace-pre-wrap text-white/80 line-clamp-6 cursor-pointer', result.description)
  description.title = 'Click to show all of it'
  description.addEventListener('click', () => description.classList.toggle('line-clamp-6'))
  const cell = el('td', 'py-2 pr-3 max-w-md', idPart, description)
  if (result.image_urls.length > 0) {
    const images = el('div', 'mt-1 flex flex-wrap gap-1')
    for (const imageUrl of result.image_urls) {
      const img = el('img', 'h-16 rounded border border-white/10 object-cover')
      img.src = imageUrl
      img.alt = 'Image in the post'
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      images.appendChild(img)
    }
    cell.appendChild(images)
  }
  if (result.post_url) {
    const postLink = el('a', 'text-glow-400 hover:text-glow-300', 'Open the post')
    postLink.href = result.post_url
    postLink.target = '_blank'
    postLink.rel = 'noopener noreferrer'
    cell.appendChild(el('div', 'mt-1', postLink))
  }
  if (result.video_not_watched) {
    cell.appendChild(el('div', 'mt-1 text-amber-300', 'Production watches this video; the draft judged it without.'))
  }
  return cell
}

function explanationCell(result, criteria) {
  const names = Object.keys(result.explanations)
  if (names.length === 0) {
    return el('td', 'py-2 text-white/50', result.draft.reasoning, el('div', 'text-white/30', 'Not explained.'))
  }
  const pointsByName = Object.fromEntries(criteria.map((criterion) => [criterion.name, criterion.points]))
  return el('td', 'py-2 text-white/60',
    el('div', 'text-white/50', result.draft.reasoning),
    ...names.map((name) => {
      const met = result.draft.criteria_met.includes(name)
      return el('div', 'mt-1',
        el('span', `font-mono ${met ? 'text-white/90' : 'text-white/40'}`, `${name} (${met ? `met, ${pointsByName[name]}` : 'not met'}): `),
        result.explanations[name])
    }))
}

function createResultRow(result, experiment) {
  let liveNote = ''
  if (result.live_reused) liveNote = 'from an earlier experiment'
  return el('tr', 'border-t border-white/10 align-top',
    postCell(result),
    ownerCell(result),
    decisionCell(result.draft, experiment.threshold, result.should_flag, ''),
    decisionCell(result.live, experiment.live_threshold, result.should_flag, liveNote),
    explanationCell(result, experiment.criteria))
}

// The draft's mistakes first, then where it decides differently from the live version.
function sortedResults(experiment) {
  const rank = (result) => {
    if (isDraftWrong(result, experiment)) return 0
    if (isChangedFromLive(result, experiment)) return 1
    return 2
  }
  return [...experiment.results].sort((first, second) => rank(first) - rank(second))
}

function createResultsTable(experiment) {
  const body = el('tbody', '')
  const tabs = el('div', 'mt-4 flex gap-1')
  function show(rowFilter) {
    tabs.replaceChildren(...ROW_FILTERS.map(([value, label]) => {
      const tab = el('button', `${TAB_CLASS} ${value === rowFilter ? TAB_CHOSEN_CLASS : TAB_IDLE_CLASS}`, label)
      tab.type = 'button'
      tab.addEventListener('click', () => show(value))
      return tab
    }))
    let results = sortedResults(experiment)
    if (rowFilter === 'wrong') results = results.filter((result) => isDraftWrong(result, experiment))
    if (rowFilter === 'changed') results = results.filter((result) => isChangedFromLive(result, experiment))
    body.replaceChildren(...results.map((result) => createResultRow(result, experiment)))
  }
  show('all')
  return el('div', '', tabs,
    el('div', 'overflow-x-auto', el('table', 'mt-2 w-full text-left text-xs text-white/70',
      el('thead', '', el('tr', 'text-white/40',
        el('th', 'pb-1 pr-3 font-medium', 'Post, as the model read it'),
        el('th', 'pb-1 pr-3 font-medium', 'Owner'),
        el('th', 'pb-1 pr-3 font-medium', 'Draft'),
        el('th', 'pb-1 pr-3 font-medium', `Live v${experiment.live_version}`),
        el('th', 'pb-1 font-medium', "Draft's reasoning and explanation"))),
      body)))
}

function experimentFactsText(experiment) {
  const startedFrom = experiment.started_from ? `experiment ${experiment.started_from}` : `live v${experiment.live_version}`
  const tokens = experiment.prompt_tokens + experiment.completion_tokens
  return `${formatDateTime(experiment.created_at)}. Started from ${startedFrom}. ${experiment.model} (${experiment.inference_source}). ` +
    `${tokens} tokens, ${costText(experiment.cost)}.`
}

function createExperimentCard(experiment) {
  const card = el('section', CARD_CLASS,
    el('div', 'flex flex-wrap items-baseline justify-between gap-2',
      el('h2', 'text-lg font-semibold text-white', `Experiment ${experiment.id} on ${experiment.plugin}`),
      el('span', 'text-xs text-white/40', experiment.status)),
    el('p', 'mt-1 text-xs text-white/50', experimentFactsText(experiment)))
  if (experiment.status === 'failed') {
    card.appendChild(createErrorBanner(`The run failed: ${experiment.error}`))
  }
  if (experiment.status === 'pending' || experiment.status === 'running') {
    const total = experiment.total_cases
    const judged = experiment.judged_cases
    const progressText = total === null ? 'Waiting for the worker...' : `Judged ${judged} of ${total} posts...`
    const bar = el('div', 'h-full bg-shield-400/60')
    bar.style.width = total ? `${Math.round((100 * judged) / total)}%` : '0%'
    card.appendChild(el('p', 'mt-3 text-sm text-white/70', progressText))
    card.appendChild(el('div', 'mt-1 h-1.5 w-full rounded bg-white/10 overflow-hidden', bar))
  }
  card.appendChild(createScoresTable(experiment))
  card.appendChild(createDraftSummary(experiment))
  if (experiment.results.length > 0) {
    card.appendChild(createResultsTable(experiment))
  }
  return card
}

// -- Past experiments --

function scoreText(experiment, source) {
  const score = experiment.scores[source]
  if (!score) return '-'
  return `${score.draft.right}/${score.cases} (live ${score.live.right})`
}

function createExperimentsTable(experiments) {
  const chosen = new Set()
  const compareButton = el('button', QUIET_BUTTON_CLASS, 'Compare the two chosen')
  compareButton.type = 'button'
  compareButton.disabled = true
  compareButton.addEventListener('click', () => {
    const [first, second] = [...chosen].sort((a, b) => a - b)
    navigate(`/tuning/compare/${first}/${second}`)
  })

  const rows = experiments.map((experiment) => {
    const box = el('input', '')
    box.type = 'checkbox'
    box.setAttribute('aria-label', `Choose experiment ${experiment.id}`)
    box.addEventListener('change', () => {
      if (box.checked) chosen.add(experiment.id)
      else chosen.delete(experiment.id)
      compareButton.disabled = chosen.size !== 2
    })
    return el('tr', 'border-t border-white/10',
      el('td', 'py-1 pr-2', box),
      el('td', 'py-1 pr-3', experimentLink(experiment.id, String(experiment.id))),
      el('td', 'py-1 pr-3 whitespace-nowrap', formatDateTime(experiment.created_at)),
      el('td', 'py-1 pr-3', experiment.status),
      el('td', 'py-1 pr-3', experiment.started_from ? String(experiment.started_from) : `live v${experiment.live_version}`),
      el('td', 'py-1 pr-3', String(experiment.threshold)),
      el('td', 'py-1 pr-3 whitespace-nowrap', scoreText(experiment, 'thumb')),
      el('td', 'py-1 pr-3 whitespace-nowrap', scoreText(experiment, 'synthetic')),
      el('td', 'py-1 pr-3', String(experiment.prompt_tokens + experiment.completion_tokens)),
      el('td', 'py-1', costText(experiment.cost)))
  })
  return el('div', '',
    el('div', 'overflow-x-auto', el('table', 'w-full text-left text-xs text-white/70',
      el('thead', '', el('tr', 'text-white/40',
        el('th', 'pb-1 pr-2 font-medium', ''),
        el('th', 'pb-1 pr-3 font-medium', 'Experiment'),
        el('th', 'pb-1 pr-3 font-medium', 'Run'),
        el('th', 'pb-1 pr-3 font-medium', 'Status'),
        el('th', 'pb-1 pr-3 font-medium', 'Started from'),
        el('th', 'pb-1 pr-3 font-medium', 'Cutoff'),
        el('th', 'pb-1 pr-3 font-medium', 'Thumbs right'),
        el('th', 'pb-1 pr-3 font-medium', 'Synthetic right'),
        el('th', 'pb-1 pr-3 font-medium', 'Tokens'),
        el('th', 'pb-1 font-medium', 'Cost'))),
      el('tbody', '', ...rows))),
    el('div', 'mt-2', compareButton))
}

// -- The page --

function draftFrom(source, startedFrom) {
  return {
    rubric_prompt: source.rubric_prompt,
    criteria: source.criteria.map((criterion) => ({ ...criterion })),
    threshold: source.threshold,
    include_synthetic: Boolean(source.include_synthetic),
    explain_every_case: Boolean(source.explain_every_case),
    started_from: startedFrom,
  }
}

function refusalText(response, data, what) {
  if (response.status === 403) return 'The tuning page is only for the site owner, signed in with Google.'
  return errorMessageFrom(data, `${what} could not load: error ${response.status}.`)
}

function createHeader(title) {
  const inboxLink = el('a', QUIET_BUTTON_CLASS, 'Inbox')
  inboxLink.href = '/inbox'
  const thumbsLink = el('a', QUIET_BUTTON_CLASS, 'Post thumbs')
  thumbsLink.href = '/inbox/thumbs'
  const tuningLink = el('a', QUIET_BUTTON_CLASS, 'Tuning')
  tuningLink.href = '/tuning'
  return el('div', 'flex flex-wrap items-center justify-between gap-4 mb-6',
    el('h1', 'text-3xl font-bold text-white', title), el('div', 'flex gap-2', tuningLink, inboxLink, thumbsLink))
}

export function mountTuningPage({ experimentId } = {}) {
  const content = el('div', '', el('p', 'text-sm text-white/50', 'Loading...'))
  const container = el('div', 'max-w-7xl mx-auto px-4 py-12', createHeader('Tuning'), content)
  let pollTimer = null
  let stopped = false

  async function load() {
    const { response, data } = await apiFetch('/tuning/filters/')
    if (!response.ok) {
      content.replaceChildren(createErrorBanner(refusalText(response, data, 'The filters')))
      return
    }
    const filters = data.filters
    if (filters.length === 0) {
      content.replaceChildren(el('p', 'text-sm text-white/50', 'No filter is scored by criteria.'))
      return
    }

    let experiment = null
    if (experimentId) {
      const found = await apiFetch(`/tuning/experiments/${experimentId}/`)
      if (!found.response.ok) {
        content.replaceChildren(createErrorBanner(refusalText(found.response, found.data, 'The experiment')))
        return
      }
      experiment = found.data
    }
    const chosenSlug = experiment ? experiment.plugin : new URLSearchParams(window.location.search).get('filter')
    const filter = filters.find((candidate) => candidate.slug === chosenSlug) || filters[0]
    const draft = experiment ? draftFrom(experiment, experiment.id) : draftFrom(filter.live, null)
    await render(filters, filter, draft, experiment)
  }

  async function render(filters, filter, draft, experiment) {
    const { response, data } = await apiFetch(`/tuning/experiments/?plugin=${filter.slug}`)
    if (!response.ok) {
      content.replaceChildren(createErrorBanner(refusalText(response, data, 'The experiments')))
      return
    }
    const pastExperiments = data.experiments

    const filterSelect = el('select', SELECT_CLASS)
    filterSelect.setAttribute('aria-label', 'Filter')
    for (const candidate of filters) {
      const option = el('option', '', `${candidate.name} (${candidate.thumb_cases} thumbs)`)
      option.value = candidate.slug
      option.selected = candidate.slug === filter.slug
      filterSelect.appendChild(option)
    }
    filterSelect.addEventListener('change', () => navigate(`/tuning?filter=${filterSelect.value}`))

    const startSelect = el('select', SELECT_CLASS)
    startSelect.setAttribute('aria-label', 'Start from')
    const liveOption = el('option', '', `Live v${filter.live.version}`)
    liveOption.value = 'live'
    startSelect.appendChild(liveOption)
    for (const past of pastExperiments) {
      const option = el('option', '', `Experiment ${past.id}, ${formatDateTime(past.created_at)}`)
      option.value = String(past.id)
      option.selected = draft.started_from === past.id
      startSelect.appendChild(option)
    }
    startSelect.addEventListener('change', () => {
      if (startSelect.value === 'live') navigate(`/tuning?filter=${filter.slug}`)
      else navigate(`/tuning/${startSelect.value}`)
    })

    async function run() {
      const created = await apiFetch('/tuning/experiments/', { method: 'POST', body: { plugin: filter.slug, ...draft } })
      if (!created.response.ok) {
        return errorMessageFrom(created.data, `Not started: error ${created.response.status}.`)
      }
      navigate(`/tuning/${created.data.id}`)
      return ''
    }

    const editorCard = el('section', CARD_CLASS,
      el('div', 'flex flex-wrap items-center gap-3 mb-4 text-sm text-white/70',
        el('label', 'flex items-center gap-2', 'Filter', filterSelect),
        el('label', 'flex items-center gap-2', 'Start from', startSelect),
        el('span', 'text-xs text-white/40', `Live cutoff ${filter.live.threshold}. ${data.experiments.length} experiments so far.`)),
      createDraftEditor(filter, draft, pastExperiments[0], run))

    const experimentSlot = el('div', '')
    const pastCard = el('section', CARD_CLASS)
    function showPastExperiments(found) {
      pastCard.replaceChildren(
        el('h2', 'text-lg font-semibold text-white mb-3', `Past experiments on ${filter.name}`),
        found.length > 0 ? createExperimentsTable(found) : el('p', 'text-sm text-white/50', 'None yet.'))
    }
    showPastExperiments(pastExperiments)
    content.replaceChildren(experimentSlot, editorCard, pastCard)

    // Once the run ends, the past experiments list shows its scores too.
    async function refreshPastExperiments() {
      const refreshed = await apiFetch(`/tuning/experiments/?plugin=${filter.slug}`)
      if (!stopped && refreshed.response.ok) showPastExperiments(refreshed.data.experiments)
    }
    if (experiment) showExperiment(experimentSlot, experiment, refreshPastExperiments)
  }

  function showExperiment(slot, experiment, onFinished) {
    slot.replaceChildren(createExperimentCard(experiment))
    if (experiment.status !== 'pending' && experiment.status !== 'running') return
    pollTimer = setTimeout(async () => {
      if (stopped) return
      const { response, data } = await apiFetch(`/tuning/experiments/${experiment.id}/`)
      if (stopped || !response.ok) return
      showExperiment(slot, data, onFinished)
      if (data.status !== 'pending' && data.status !== 'running') onFinished()
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

// -- Comparing two experiments --

function compareRow(first, second, firstResult, secondResult) {
  const description = el('p', 'whitespace-pre-wrap text-white/80 line-clamp-4', firstResult.description)
  return el('tr', 'border-t border-white/10 align-top',
    el('td', 'py-2 pr-3 max-w-md', el('div', 'text-white/50', firstResult.case_id), description),
    el('td', 'py-2 pr-3 whitespace-nowrap', firstResult.should_flag ? 'Should flag' : 'Should allow'),
    decisionCell(firstResult.draft, first.threshold, firstResult.should_flag, ''),
    decisionCell(secondResult.draft, second.threshold, secondResult.should_flag, ''))
}

function createComparison(first, second) {
  const secondByCase = Object.fromEntries(second.results.map((result) => [result.case_id, result]))
  const differing = []
  let sameCount = 0
  for (const firstResult of first.results) {
    const secondResult = secondByCase[firstResult.case_id]
    if (!secondResult) continue
    if (flags(firstResult.draft, first.threshold) === flags(secondResult.draft, second.threshold)) {
      sameCount += 1
    } else {
      differing.push(compareRow(first, second, firstResult, secondResult))
    }
  }

  const sideBySide = el('div', 'grid gap-4 md:grid-cols-2',
    ...[first, second].map((experiment) => el('div', '',
      el('h2', 'text-lg font-semibold text-white', experimentLink(experiment.id)),
      el('p', 'mt-1 text-xs text-white/50', experimentFactsText(experiment)),
      createScoresTable(experiment),
      createDraftSummary(experiment))))
  return el('div', '',
    el('section', CARD_CLASS, sideBySide),
    el('section', CARD_CLASS,
      el('p', 'text-sm text-white/70', `${differing.length} posts decided differently, ${sameCount} the same.`),
      differing.length > 0
        ? el('div', 'overflow-x-auto', el('table', 'mt-2 w-full text-left text-xs text-white/70',
          el('thead', '', el('tr', 'text-white/40',
            el('th', 'pb-1 pr-3 font-medium', 'Post'),
            el('th', 'pb-1 pr-3 font-medium', 'Owner'),
            el('th', 'pb-1 pr-3 font-medium', `Experiment ${first.id}`),
            el('th', 'pb-1 pr-3 font-medium', `Experiment ${second.id}`))),
          el('tbody', '', ...differing)))
        : ''))
}

export function mountTuningComparePage({ first, second }) {
  const content = el('div', '', el('p', 'text-sm text-white/50', 'Loading...'))
  const container = el('div', 'max-w-7xl mx-auto px-4 py-12', createHeader(`Experiments ${first} and ${second}`), content)

  async function load() {
    const loaded = await Promise.all([first, second].map((id) => apiFetch(`/tuning/experiments/${id}/`)))
    for (const { response, data } of loaded) {
      if (!response.ok) {
        content.replaceChildren(createErrorBanner(refusalText(response, data, 'The experiment')))
        return
      }
    }
    content.replaceChildren(createComparison(loaded[0].data, loaded[1].data))
  }

  load()
  return { el: container }
}
