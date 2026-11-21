import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { filterFromTerms, mountFeatureTuningPage, termsText } from './FeatureTuningPage.js'

const FEATURES = [
  { name: 'pull', description: 'How much it grabs attention.', levels: [{ text: 'Calm.', examples: ['A notice.'] }, { text: 'Some hooks.', examples: [] }, { text: 'Relentless.', examples: [] }] },
  { name: 'emptiness', description: 'What a reader is left with.', levels: [{ text: 'Substantial.', examples: [] }, { text: 'Nothing.', examples: [] }] },
]
const FILTERS = [
  { plugin: 'brainrot', form: 'product', features: ['pull', 'emptiness'], cutoff: 50 },
  { plugin: 'low-effort', form: 'weighted_sum', weights: { emptiness: 10 }, cutoff: 80 },
]
const LIVE = { brainrot: { version_id: 9, version: 3, threshold: 60 }, 'low-effort': { version_id: 10, version: 3, threshold: 60 } }

function post(text) {
  return { platform: 'x', kind: 'post', author: 'sam', community: '', text, quoted_post: {}, link_preview: {}, parent_text: null, parent_is_reply: false, thread_text: null }
}

function liveAnswer(score) {
  return { failed: false, score, criteria_met: [], reasoning: 'A post.' }
}

// Labeled shown; the draft blocks it as brainrot (60) and low-effort (100).
const LOL = {
  case_id: 'judgment-1', source: 'thumb', judgment_id: 1, post: post('lol'), image_urls: [], post_url: '',
  expected: { brainrot: false, 'low-effort': false },
  owner: { verdict: 'right', shown_action: 'allow', should_be: 'shown', plugin: '', details: '' },
  video_not_watched: false, scores: { pull: 6, emptiness: 10 }, failed: false,
  reasons: { pull: 'Some hooks.', emptiness: 'Nothing to take away.' },
  live: { brainrot: liveAnswer(0), 'low-effort': liveAnswer(0) },
  filter_scores: { brainrot: 60, 'low-effort': 100 },
}

// Blocked as low-effort, and the draft blocks it.
const FILLER = {
  ...LOL, case_id: 'judgment-2', judgment_id: 2, post: post('so true'), expected: { 'low-effort': true },
  owner: { verdict: 'wrong', shown_action: 'allow', should_be: 'blocked', plugin: 'low-effort', details: '' },
  scores: { pull: 0, emptiness: 9 }, live: { 'low-effort': liveAnswer(0) }, filter_scores: { 'low-effort': 90 },
}

function experiment(overrides = {}) {
  return {
    id: 3, created_at: '2026-11-20T10:00:00+00:00', finished_at: '2026-11-20T10:01:00+00:00', status: 'done', error: '',
    started_from: null, started_from_feature_set: 1, filters: FILTERS, live: LIVE, features: FEATURES,
    include_synthetic: false, explain_every_case: false, model: 'test/model', inference_source: 'openrouter',
    total_cases: 2, judged_cases: 2, scores: {}, prompt_tokens: 1800, cached_prompt_tokens: 900, completion_tokens: 40, cost: null,
    system_prompt: 'You rate one social media post...', results: [LOL, FILLER], ...overrides,
  }
}

const OVERVIEW = {
  feature_set: { id: 1, version: 1, features: FEATURES, filters: FILTERS },
  filters: [
    { slug: 'brainrot', name: 'Brainrot', input_kind: 'video', live: { version: 3, threshold: 60 }, thumb_cases: 1, synthetic_cases: 0 },
    { slug: 'low-effort', name: 'Low effort', input_kind: 'post', live: { version: 3, threshold: 60 }, thumb_cases: 2, synthetic_cases: 0 },
  ],
  model: 'test/model',
  inference_source: 'openrouter',
  experiments: [experiment()],
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeServer(routes) {
  return vi.fn(async (url, options = {}) => {
    const path = String(url).replace('/api', '')
    const handler = routes[`${options.method || 'GET'} ${path}`]
    if (!handler) return jsonResponse({}, 404)
    return handler(options)
  })
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('FeatureTuningPage', () => {
  it('writes formula terms both ways', () => {
    expect(termsText(FILTERS[0])).toBe('pull, emptiness')
    expect(termsText({ plugin: 'rude', form: 'weighted_sum', weights: { hostility: 10, humor: -6 }, cutoff: 60 })).toBe('hostility*10, humor*-6')
    expect(filterFromTerms('rude', 'weighted_sum', 'hostility*10, humor * -6', 60)).toEqual(
      { plugin: 'rude', form: 'weighted_sum', weights: { hostility: 10, humor: -6 }, cutoff: 60 })
    expect(filterFromTerms('rude', 'weighted_sum', 'hostility', 60)).toMatch(/feature\*multiplier/)
  })

  it('starts a draft from the saved feature set and sends it as one experiment', async () => {
    let sent = null
    vi.stubGlobal('fetch', fakeServer({
      'GET /tuning/features/': () => jsonResponse(OVERVIEW),
      'POST /tuning/feature-experiments/': (options) => {
        sent = JSON.parse(options.body)
        return jsonResponse(experiment({ id: 4, status: 'pending', results: [] }), 201)
      },
    }))
    document.cookie = 'csrftoken=test'
    renderElement(mountFeatureTuningPage().el)

    expect(await screen.findByText(/Production's Brainrot watches videos/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('Feature name').map((input) => input.value)).toEqual(['pull', 'emptiness'])
    // Three levels sit at 0, 5 and 10.
    expect(screen.getAllByText(/^at /).slice(0, 3).map((point) => point.textContent)).toEqual(['at 0', 'at 5', 'at 10'])
    fireEvent.input(screen.getAllByLabelText('Filter cutoff')[1], { target: { value: '70' } })
    fireEvent.click(screen.getByText('Run'))

    await waitFor(() => expect(sent).not.toBeNull())
    expect(sent.features).toEqual(FEATURES)
    expect(sent.filters).toEqual([FILTERS[0], { ...FILTERS[1], cutoff: 70 }])
    expect(sent.started_from_feature_set).toBe(1)
  })

  it('shows each filter against its test set and recomputes it when a cutoff moves', async () => {
    vi.stubGlobal('fetch', fakeServer({
      'GET /tuning/features/': () => jsonResponse(OVERVIEW),
      'GET /tuning/feature-experiments/3/': () => jsonResponse(experiment()),
    }))
    renderElement(mountFeatureTuningPage({ experimentId: '3' }).el)

    expect(await screen.findByText('Feature experiment 3')).toBeInTheDocument()
    expect(screen.getByText('2: 1 right, 0 missed (should block, allowed), 1 wrongly blocked')).toBeInTheDocument()
    expect(screen.getByText('live: 1 right, 1 missed (should block, allowed), 0 wrongly blocked')).toBeInTheDocument()
    const lines = screen.getAllByRole('button', { expanded: false })
    expect(lines[0]).toHaveTextContent('lol')
    expect(lines[0]).toHaveTextContent('You: shown')
    expect(lines[0]).toHaveTextContent('brainrot 60/50 block, low-effort 100/80 block')

    fireEvent.change(screen.getByLabelText('Cutoff for low-effort'), { target: { value: '95' } })
    expect(screen.getByText('2: 0 right, 1 missed (should block, allowed), 1 wrongly blocked')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Cutoff for brainrot'), { target: { value: '70' } })
    expect(screen.getByText('1: 1 right, 0 missed (should block, allowed), 0 wrongly blocked')).toBeInTheDocument()
  })

  it('opens a post with its ratings, each filter decision and its label', async () => {
    vi.stubGlobal('fetch', fakeServer({
      'GET /tuning/features/': () => jsonResponse(OVERVIEW),
      'GET /tuning/feature-experiments/3/': () => jsonResponse(experiment()),
    }))
    renderElement(mountFeatureTuningPage({ experimentId: '3' }).el)

    fireEvent.click(await screen.findByText('lol'))
    expect(screen.getByText('Nothing to take away.')).toBeInTheDocument()
    expect(screen.getByText('block, 60/50')).toBeInTheDocument()
    expect(screen.getByLabelText('Label').selectedOptions[0].textContent).toBe('Should be shown')
  })
})
