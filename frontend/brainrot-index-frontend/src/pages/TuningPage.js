// The owner's tuning page: how a draft of a filter's rubric decides the
// posts the owner labeled with thumbs, beside the live version, so he can see
// where the filter is wrong and clean up bad labels. /tuning lists the
// experiments on a filter; /tuning/<id> shows one, a line per post with the
// wrong ones first, and a click on a line opens the post as a reader sees it
// with the criteria that decided its score. The draft editor stays folded
// away behind "Edit draft": every run is saved as an experiment, judged by the
// background worker with the production prompt and model.
// /tuning/compare/<id>/<id> lists the posts two experiments decide
// differently. Nothing here changes live filtering. The server refuses
// everyone but the owner (the account the admin lets in).

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { navigate } from '../lib/router.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { ACCENT_BUTTON_CLASS, CARD_CLASS, INPUT_CLASS, LABEL_CLASS, QUIET_BUTTON_CLASS, SELECT_CLASS } from '../components/styles.js'

const POLL_MILLISECONDS = 2000
const SMALL_BUTTON_CLASS = 'px-2 py-0.5 rounded text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-60'
const RIGHT_CLASS = 'text-glow-300'
const WRONG_CLASS = 'text-red-300'
const FAILED_CLASS = 'text-amber-300'
const PLATFORM_NAMES = { reddit: 'Reddit', x: 'X', youtube: 'YouTube' }
const SOURCE_NAMES = { thumb: 'Your thumbs', synthetic: 'Test set' }

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

function decisionWord(blocks) {
  if (blocks) return 'block'
  return 'allow'
}

function isRight(answer, threshold, result) {
  return !answer.failed && flags(answer, threshold) === result.should_flag
}

function draftDiffersFromLive(result, experiment) {
  return flags(result.draft, experiment.threshold) !== flags(result.live, experiment.live_threshold)
}

// "allow, 30/60": the decision, then the score against the cutoff.
function answerText(answer, threshold) {
  if (answer.failed) return 'failed'
  return `${decisionWord(flags(answer, threshold))}, ${answer.score}/${threshold}`
}

// "10 right, 3 missed (should block, allowed), 2 wrongly blocked", and failures when there are any.
export function countsText(counts) {
  let text = `${counts.right} right, ${counts.missed} missed (should block, allowed), ${counts.wrongly_flagged} wrongly blocked`
  if (counts.failed > 0) text += `, ${counts.failed} failed`
  return text
}

function maxScore(criteria) {
  return criteria.reduce((total, criterion) => total + Math.max(0, criterion.points), 0)
}

function experimentLink(id, text = `Experiment ${id}`) {
  const link = el('a', 'text-glow-400 hover:text-glow-300', text)
  link.href = `/tuning/${id}`
  return link
}

function createImage(imageUrl, className) {
  const img = el('img', className)
  img.src = imageUrl
  img.alt = 'Image in the post'
  img.loading = 'lazy'
  img.referrerPolicy = 'no-referrer'
  return img
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
    lastCostText = `The last one judged ${lastExperiment.judged_cases} posts for ${costText(lastExperiment.cost)}.`
  }
  const syntheticText = filter.synthetic_cases > 0
    ? `Also the test set (${filter.synthetic_cases})`
    : 'No test set examples for this filter'

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
    el('div', 'mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/70',
      el('label', 'flex items-center gap-2', 'Cutoff', thresholdInput),
      el('label', 'flex items-center gap-2', syntheticBox, syntheticText),
      el('label', 'flex items-center gap-2', explainBox, 'Explain every post'),
      runButton,
      el('span', 'text-xs text-white/50', `${filter.thumb_cases} thumbs. ${lastCostText}`)),
    runStatus)
}

// -- One post --

// The first words a reader would see of the post.
function excerptOf(post) {
  return post.text || post.quoted_post.text || post.link_preview.text || post.link_preview.url || '(no text)'
}

function bylineOf(post) {
  let byline = `${PLATFORM_NAMES[post.platform]} ${post.kind}`
  if (post.author) byline += ` by ${post.author}`
  if (post.community) byline += ` in ${post.community}`
  return byline
}

// What a reply answers, quieter than the reply itself.
function createContext(post) {
  if (post.thread_text === null && post.parent_text === null) return ''
  const context = el('div', 'mb-2 space-y-1 border-l-2 border-white/10 pl-3 text-xs text-white/45')
  if (post.thread_text !== null) {
    context.appendChild(el('p', 'whitespace-pre-wrap line-clamp-4', el('span', 'text-white/30', 'Thread: '), post.thread_text))
  }
  if (post.parent_text !== null) {
    const label = post.parent_is_reply ? 'Replying to a reply: ' : 'Replying to: '
    context.appendChild(el('p', 'whitespace-pre-wrap line-clamp-6', el('span', 'text-white/30', label), post.parent_text))
  }
  return context
}

// The post as it shows in a feed.
function createPostCard(result) {
  const post = result.post
  const card = el('div', 'rounded-xl border border-white/10 bg-white/[0.03] p-3',
    el('p', 'text-xs text-white/40', bylineOf(post)),
    el('p', 'mt-1 whitespace-pre-wrap break-words text-sm text-white/90', post.text))
  if ('text' in post.quoted_post) {
    card.appendChild(el('div', 'mt-2 rounded-lg border border-white/10 p-2 text-sm text-white/70',
      el('p', 'text-xs text-white/40', `Quoting ${post.quoted_post.author || 'an unknown author'}`),
      el('p', 'whitespace-pre-wrap break-words', post.quoted_post.text)))
  }
  if ('url' in post.link_preview) {
    const previewLink = el('a', 'mt-2 block rounded-lg border border-white/10 p-2 text-sm text-white/70 hover:bg-white/5',
      el('p', 'text-xs text-white/40', post.link_preview.domain || post.link_preview.url),
      el('p', 'whitespace-pre-wrap break-words line-clamp-3', post.link_preview.text))
    previewLink.href = post.link_preview.url
    previewLink.target = '_blank'
    previewLink.rel = 'noopener noreferrer'
    card.appendChild(previewLink)
  }
  if (result.image_urls.length > 0) {
    card.appendChild(el('div', 'mt-2 flex flex-wrap gap-2',
      ...result.image_urls.map((imageUrl) => createImage(imageUrl, 'max-h-72 max-w-full rounded-lg border border-white/10'))))
  }
  if (result.video_not_watched) {
    card.appendChild(el('p', `mt-2 text-xs ${FAILED_CLASS}`, 'Production watches this video; the draft judged it without.'))
  }
  if (result.post_url) {
    const postLink = el('a', 'mt-2 inline-block text-xs text-glow-400 hover:text-glow-300', 'Open the post')
    postLink.href = result.post_url
    postLink.target = '_blank'
    postLink.rel = 'noopener noreferrer'
    card.appendChild(postLink)
  }
  return card
}

function pointsText(points) {
  if (points > 0) return `+${points}`
  return String(points)
}

// Why the answer scored what it did: the criteria met, each in a sentence.
// The unmet ones, which added nothing, wait behind a toggle.
function createReason(title, answer, criteria, explanations, threshold) {
  if (answer.failed) return el('p', `text-sm ${FAILED_CLASS}`, `${title}: the model gave no usable answer.`)
  const sentenceOf = (criterion) => explanations[criterion.name] || criterion.question
  const criterionItem = (criterion) => el('li', 'flex gap-2',
    el('span', 'w-9 shrink-0 text-right font-semibold text-white/60', pointsText(criterion.points)),
    el('span', '', sentenceOf(criterion)))
  const met = criteria.filter((criterion) => answer.criteria_met.includes(criterion.name))
  const unmet = criteria.filter((criterion) => !answer.criteria_met.includes(criterion.name))

  const verdict = `${title}: ${answerText(answer, threshold)}`
  const reason = el('div', 'text-sm text-white/80',
    el('p', 'text-xs text-white/50', met.length > 0 ? `${verdict}, because:` : `${verdict}; no criterion met.`),
    el('ul', 'mt-1 space-y-1', ...met.map(criterionItem)))
  if (unmet.length > 0) {
    const unmetList = el('ul', 'mt-1 space-y-1 text-white/45', ...unmet.map(criterionItem))
    unmetList.hidden = true
    const toggle = el('button', `${SMALL_BUTTON_CLASS} mt-1 -ml-2`, `Show ${unmet.length} unmet`)
    toggle.type = 'button'
    toggle.addEventListener('click', () => {
      unmetList.hidden = !unmetList.hidden
      toggle.textContent = unmetList.hidden ? `Show ${unmet.length} unmet` : 'Hide unmet'
    })
    reason.append(toggle, unmetList)
  }
  return reason
}

// Fixing the owner's label: flip it, note it, or delete it.
function createLabelControls(result) {
  if (result.source === 'synthetic') {
    return el('p', 'text-xs text-white/50', `Test set says ${decisionWord(result.should_flag)}: ${result.owner.why}`)
  }
  if (result.judgment_id === null) {
    return el('p', 'text-xs text-white/40', 'This thumbs was deleted.')
  }
  let verdict = result.owner.verdict
  let shouldBlock = result.should_flag
  const labelText = el('span', 'text-white/60')
  const flipButton = el('button', SMALL_BUTTON_CLASS)
  flipButton.type = 'button'
  function showLabel() {
    labelText.textContent = `You said ${decisionWord(shouldBlock)}.`
    flipButton.textContent = `Change to ${decisionWord(!shouldBlock)}`
  }
  showLabel()
  const deleteButton = el('button', `${SMALL_BUTTON_CLASS} text-red-300`, 'Delete')
  deleteButton.type = 'button'
  const noteInput = el('input', `${INPUT_CLASS} py-1 text-xs`)
  noteInput.value = result.owner.details
  noteInput.placeholder = 'Note'
  noteInput.setAttribute('aria-label', 'Thumbs note')
  const saveNoteButton = el('button', `${SMALL_BUTTON_CLASS} whitespace-nowrap`, 'Save note')
  saveNoteButton.type = 'button'
  const status = el('span', 'text-white/40')

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
    const nextVerdict = verdict === 'right' ? 'wrong' : 'right'
    if (await change('PATCH', { verdict: nextVerdict }, 'Saved; the next run uses it.')) {
      verdict = nextVerdict
      shouldBlock = !shouldBlock
      showLabel()
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
  return el('div', 'space-y-1 border-t border-white/10 pt-2 text-xs',
    el('div', 'flex flex-wrap items-center gap-1', labelText, flipButton, deleteButton, status),
    el('div', 'flex gap-1', noteInput, saveNoteButton))
}

// One post on one line; a click opens it below, made by createOpened.
function createPostRow(result, mark, lineParts, rowClass, createOpened) {
  const thumbnailSlot = el('span', 'h-7 w-7 shrink-0')
  if (result.image_urls.length > 0) {
    thumbnailSlot.appendChild(createImage(result.image_urls[0], 'h-7 w-7 rounded object-cover'))
  }
  const line = el('button', 'flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-left text-sm hover:bg-white/5 sm:flex-nowrap',
    mark,
    thumbnailSlot,
    el('span', 'min-w-0 flex-1 basis-40 truncate text-white/85', excerptOf(result.post)),
    el('span', 'w-14 shrink-0 text-xs text-white/40', PLATFORM_NAMES[result.post.platform]),
    ...lineParts)
  line.type = 'button'
  line.setAttribute('aria-expanded', 'false')
  const row = el('div', `border-t border-white/5 first:border-t-0 ${rowClass}`, line)
  let opened = null
  line.addEventListener('click', () => {
    if (opened) {
      opened.remove()
      opened = null
    } else {
      opened = createOpened()
      row.appendChild(opened)
    }
    line.setAttribute('aria-expanded', String(opened !== null))
  })
  return row
}

function createOpenedPost(result, ...sideParts) {
  return el('div', 'grid gap-4 px-3 pb-4 pt-1 sm:pl-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
    el('div', 'min-w-0', createContext(result.post), createPostCard(result)),
    el('div', 'min-w-0 space-y-3', ...sideParts))
}

function ownerPart(result) {
  const who = result.source === 'synthetic' ? 'Test set' : 'You'
  return el('span', 'w-24 shrink-0 whitespace-nowrap text-white/70', `${who}: ${decisionWord(result.should_flag)}`)
}

// -- An experiment --

function createResultRow(result, experiment) {
  let mark = el('span', `w-12 shrink-0 text-xs font-semibold ${WRONG_CLASS}`, 'wrong')
  let rowClass = 'border-l-2 border-l-red-400/70 bg-red-500/[0.06]'
  if (result.draft.failed) {
    mark = el('span', `w-12 shrink-0 text-xs font-semibold ${FAILED_CLASS}`, 'failed')
    rowClass = 'border-l-2 border-l-amber-400/70'
  } else if (isRight(result.draft, experiment.threshold, result)) {
    mark = el('span', `w-12 shrink-0 text-xs font-semibold ${RIGHT_CLASS}`, 'right')
    rowClass = 'opacity-60 hover:opacity-100'
  }
  let draftText = `Draft: ${answerText(result.draft, experiment.threshold)}`
  if (draftDiffersFromLive(result, experiment)) {
    draftText += ` (live: ${decisionWord(flags(result.live, experiment.live_threshold))})`
  }
  return createPostRow(result, mark,
    [ownerPart(result), el('span', 'shrink-0 whitespace-nowrap text-white/70 sm:w-56', draftText)],
    rowClass,
    () => createOpenedPost(result,
      createReason('Draft', result.draft, experiment.criteria, result.explanations, experiment.threshold),
      createLabelControls(result)))
}

// view: { onlyDiffering, rightOpen }, kept while the page polls a running experiment.
function createResultsList(experiment, view) {
  const differingBox = el('input', '')
  differingBox.type = 'checkbox'
  differingBox.checked = view.onlyDiffering
  const listSlot = el('div', '')

  function show() {
    let results = experiment.results
    if (view.onlyDiffering) results = results.filter((result) => draftDiffersFromLive(result, experiment))
    const wrong = results.filter((result) => !isRight(result.draft, experiment.threshold, result))
    const right = results.filter((result) => isRight(result.draft, experiment.threshold, result))

    let wrongPart = el('p', 'py-2 text-sm text-white/50', 'The draft gets every one of these right.')
    if (wrong.length > 0) {
      wrongPart = el('div', 'overflow-hidden rounded-xl border border-white/10',
        ...wrong.map((result) => createResultRow(result, experiment)))
    }
    const rightPart = el('details', 'mt-3',
      el('summary', 'cursor-pointer text-sm text-white/50 hover:text-white/80', `${right.length} right`),
      el('div', 'mt-2 overflow-hidden rounded-xl border border-white/10',
        ...right.map((result) => createResultRow(result, experiment))))
    rightPart.open = view.rightOpen
    rightPart.addEventListener('toggle', () => { view.rightOpen = rightPart.open })
    listSlot.replaceChildren(wrongPart, right.length > 0 ? rightPart : '')
  }
  differingBox.addEventListener('change', () => {
    view.onlyDiffering = differingBox.checked
    show()
  })
  show()
  return el('div', 'mt-4',
    el('label', 'mb-2 flex items-center gap-2 text-xs text-white/60', differingBox, 'Only where draft differs from live'),
    listSlot)
}

function createCounts(experiment) {
  const lines = []
  for (const source of ['thumb', 'synthetic']) {
    const score = experiment.scores[source]
    if (!score) continue
    lines.push(el('p', 'text-sm',
      el('span', 'text-white/50', `${SOURCE_NAMES[source]} (${score.cases}): `),
      el('span', 'font-semibold text-white', countsText(score.draft)),
      el('span', 'text-white/40', `. Live v${experiment.live_version}: ${countsText(score.live)}.`)))
  }
  return el('div', 'mt-3 space-y-1', ...lines)
}

function experimentFactsText(experiment) {
  const startedFrom = experiment.started_from ? `experiment ${experiment.started_from}` : `live v${experiment.live_version}`
  const tokens = experiment.prompt_tokens + experiment.completion_tokens
  return `${formatDateTime(experiment.created_at)}, from ${startedFrom}, cutoff ${experiment.threshold} (live ${experiment.live_threshold}). ` +
    `${experiment.model} (${experiment.inference_source}), ${tokens} tokens, ${costText(experiment.cost)}.`
}

function createExperimentCard(experiment, view) {
  const card = el('section', CARD_CLASS,
    el('div', 'flex flex-wrap items-baseline justify-between gap-2',
      el('h2', 'text-lg font-semibold text-white', `Experiment ${experiment.id} on ${experiment.plugin}`),
      el('span', 'text-xs text-white/40', experimentFactsText(experiment))))
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
  card.appendChild(createCounts(experiment))
  if (experiment.results.length > 0) {
    card.appendChild(createResultsList(experiment, view))
  }
  return card
}

// -- The experiments on a filter --

function scoreText(experiment, source) {
  const score = experiment.scores[source]
  if (!score) return '-'
  return `${score.draft.right}/${score.cases} (live ${score.live.right})`
}

function createExperimentsTable(experiments, shownId) {
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
    const shownClass = experiment.id === shownId ? 'bg-white/5' : ''
    return el('tr', `border-t border-white/10 ${shownClass}`,
      el('td', 'py-1 pl-1 pr-2', box),
      el('td', 'py-1 pr-3', experimentLink(experiment.id)),
      el('td', 'py-1 pr-3 whitespace-nowrap', formatDateTime(experiment.created_at)),
      el('td', 'py-1 pr-3', experiment.status),
      el('td', 'py-1 pr-3 whitespace-nowrap', experiment.started_from ? `experiment ${experiment.started_from}` : `live v${experiment.live_version}`),
      el('td', 'py-1 pr-3', String(experiment.threshold)),
      el('td', 'py-1 pr-3 whitespace-nowrap', scoreText(experiment, 'thumb')),
      el('td', 'py-1 pr-3 whitespace-nowrap', scoreText(experiment, 'synthetic')),
      el('td', 'py-1 whitespace-nowrap', costText(experiment.cost)))
  })
  return el('div', '',
    el('div', 'overflow-x-auto', el('table', 'w-full text-left text-xs text-white/70',
      el('thead', '', el('tr', 'text-white/40',
        el('th', 'pb-1 pr-2 font-medium', ''),
        el('th', 'pb-1 pr-3 font-medium', ''),
        el('th', 'pb-1 pr-3 font-medium', 'When'),
        el('th', 'pb-1 pr-3 font-medium', 'Status'),
        el('th', 'pb-1 pr-3 font-medium', 'Started from'),
        el('th', 'pb-1 pr-3 font-medium', 'Cutoff'),
        el('th', 'pb-1 pr-3 font-medium', 'Thumbs right'),
        el('th', 'pb-1 pr-3 font-medium', 'Test set right'),
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
  const view = { onlyDiffering: false, rightOpen: false }
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
      const option = el('option', '', candidate.name)
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
      el('label', 'mb-4 flex items-center gap-2 text-sm text-white/70', 'Start from', startSelect),
      createDraftEditor(filter, draft, pastExperiments[0], run))
    editorCard.hidden = true
    const editButton = el('button', ACCENT_BUTTON_CLASS, 'Edit draft')
    editButton.type = 'button'
    editButton.addEventListener('click', () => {
      editorCard.hidden = !editorCard.hidden
      editButton.textContent = editorCard.hidden ? 'Edit draft' : 'Hide draft'
    })
    const toolbar = el('div', 'mb-6 flex flex-wrap items-center gap-3 text-sm text-white/70',
      el('label', 'flex items-center gap-2', 'Filter', filterSelect),
      el('span', 'text-xs text-white/40', `Live v${filter.live.version}, cutoff ${filter.live.threshold}, ${filter.thumb_cases} thumbs.`),
      el('span', 'flex-1'),
      editButton)

    const experimentSlot = el('div', '')
    const pastCard = el('section', CARD_CLASS)
    function showPastExperiments(found) {
      pastCard.replaceChildren(
        el('h2', 'text-lg font-semibold text-white mb-3', `Experiments on ${filter.name}`),
        found.length > 0 ? createExperimentsTable(found, experiment ? experiment.id : null) : el('p', 'text-sm text-white/50', 'None yet.'))
    }
    showPastExperiments(pastExperiments)
    content.replaceChildren(toolbar, editorCard, experimentSlot, pastCard)

    // Once the run ends, the experiments list shows its scores too.
    async function refreshPastExperiments() {
      const refreshed = await apiFetch(`/tuning/experiments/?plugin=${filter.slug}`)
      if (!stopped && refreshed.response.ok) showPastExperiments(refreshed.data.experiments)
    }
    if (experiment) showExperiment(experimentSlot, experiment, refreshPastExperiments)
  }

  function showExperiment(slot, experiment, onFinished) {
    slot.replaceChildren(createExperimentCard(experiment, view))
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

function createCompareRow(first, second, firstResult, secondResult) {
  let rightId = 'neither'
  if (isRight(firstResult.draft, first.threshold, firstResult)) rightId = `${first.id} right`
  if (isRight(secondResult.draft, second.threshold, secondResult)) rightId = `${second.id} right`
  const decisionPart = (experiment, result) => {
    const rightness = isRight(result.draft, experiment.threshold, result) ? RIGHT_CLASS : WRONG_CLASS
    return el('span', `shrink-0 whitespace-nowrap sm:w-36 ${rightness}`, `${experiment.id}: ${answerText(result.draft, experiment.threshold)}`)
  }
  return createPostRow(firstResult,
    el('span', 'w-16 shrink-0 text-xs font-semibold text-white/60', rightId),
    [ownerPart(firstResult), decisionPart(first, firstResult), decisionPart(second, secondResult)],
    '',
    () => createOpenedPost(firstResult,
      createReason(`Experiment ${first.id}`, firstResult.draft, first.criteria, firstResult.explanations, first.threshold),
      createReason(`Experiment ${second.id}`, secondResult.draft, second.criteria, secondResult.explanations, second.threshold)))
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
      differing.push(createCompareRow(first, second, firstResult, secondResult))
    }
  }

  const summaries = [first, second].map((experiment) => el('div', '',
    el('div', 'flex flex-wrap items-baseline gap-x-3',
      el('h2', 'text-base font-semibold text-white', experimentLink(experiment.id)),
      el('span', 'text-xs text-white/40', experimentFactsText(experiment))),
    createCounts(experiment)))
  return el('section', CARD_CLASS,
    el('div', 'space-y-4', ...summaries),
    el('p', 'mt-6 mb-2 text-sm text-white/70', `${differing.length} posts decided differently, ${sameCount} the same.`),
    differing.length > 0 ? el('div', 'overflow-hidden rounded-xl border border-white/10', ...differing) : '')
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
