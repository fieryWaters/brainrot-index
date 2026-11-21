import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { mountTuningPage, mountTuningComparePage } from './TuningPage.js'

const CRITERIA = [
  { name: 'caps', question: 'Is it written in capitals?', points: 60 },
  { name: 'insult', question: 'Does it insult someone?', points: 40 },
]

const FILTERS = {
  filters: [{
    slug: 'shouting', name: 'Shouting', input_kind: 'post',
    live: { version: 1, rubric_prompt: 'Judge shouting.', criteria: CRITERIA, threshold: 50 },
    thumb_cases: 2, synthetic_cases: 0,
  }],
  model: 'test/model',
  inference_source: 'openrouter',
}

function answer(score, criteriaMet) {
  return { failed: false, score, criteria_met: criteriaMet, reasoning: 'A post in capitals.' }
}

function post(text, overrides = {}) {
  return {
    platform: 'x', kind: 'post', author: 'sam', community: '', text, quoted_post: {}, link_preview: {},
    parent_text: null, parent_is_reply: false, thread_text: null, ...overrides,
  }
}

// The owner said allow; the draft allows it too, the live version blocks it.
const CHEERFUL = {
  case_id: 'judgment-7', source: 'thumb', judgment_id: 7,
  post: post('GOOD MORNING EVERYONE'),
  image_urls: [], post_url: 'https://x.com/a/status/1', should_flag: false,
  owner: { verdict: 'wrong', shown_action: 'hide', plugin: 'shouting', details: 'Just cheerful.' },
  video_not_watched: false, draft: answer(0, []), live: answer(60, ['caps']), live_reused: false,
  explanations: { caps: 'It greets people.', insult: 'Nobody is insulted.' },
}

// The owner said block, and the draft lets it through.
const RUDE = {
  case_id: 'judgment-8', source: 'thumb', judgment_id: 8,
  post: post('you are all wrong and dumb', { kind: 'reply', parent_text: 'What do you think of my cat?' }),
  image_urls: [], post_url: 'https://x.com/a/status/2', should_flag: true,
  owner: { verdict: 'right', shown_action: 'hide', plugin: 'shouting', details: '' },
  video_not_watched: false, draft: answer(40, ['insult']), live: answer(40, ['insult']), live_reused: false,
  explanations: { caps: 'It is in lowercase.', insult: 'It calls people dumb.' },
}

function experiment(overrides = {}) {
  return {
    id: 4, plugin: 'shouting', created_at: '2026-11-20T10:00:00+00:00', finished_at: '2026-11-20T10:01:00+00:00',
    status: 'done', error: '', live_version: 1, live_threshold: 50, started_from: null, threshold: 50,
    include_synthetic: false, explain_every_case: false, model: 'test/model', inference_source: 'openrouter',
    total_cases: 2, judged_cases: 2,
    scores: { thumb: { cases: 2, draft: { right: 1, missed: 1, wrongly_flagged: 0, failed: 0 }, live: { right: 0, missed: 1, wrongly_flagged: 1, failed: 0 } } },
    prompt_tokens: 2700, completion_tokens: 180, cost: 0.0004,
    rubric_prompt: 'Judge shouting at people.', criteria: CRITERIA,
    results: [CHEERFUL, RUDE],
    ...overrides,
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeServer(routes) {
  return vi.fn(async (url, options = {}) => {
    const path = String(url).replace('/api', '')
    const method = options.method || 'GET'
    const handler = routes[`${method} ${path}`]
    if (!handler) return jsonResponse({}, 404)
    return handler(options)
  })
}

function showExperimentFour(extraRoutes = {}) {
  vi.stubGlobal('fetch', fakeServer({
    'GET /tuning/filters/': () => jsonResponse(FILTERS),
    'GET /tuning/experiments/4/': () => jsonResponse(experiment()),
    'GET /tuning/experiments/?plugin=shouting': () => jsonResponse({ experiments: [experiment()] }),
    ...extraRoutes,
  }))
  renderElement(mountTuningPage({ experimentId: '4' }).el)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('TuningPage', () => {
  it('leads with the experiments and keeps the draft editor folded until asked for', async () => {
    let sentDraft = null
    vi.stubGlobal('fetch', fakeServer({
      'GET /tuning/filters/': () => jsonResponse(FILTERS),
      'GET /tuning/experiments/?plugin=shouting': () => jsonResponse({ experiments: [experiment()] }),
      'POST /tuning/experiments/': (options) => {
        sentDraft = JSON.parse(options.body)
        return jsonResponse(experiment({ id: 5, status: 'pending' }), 201)
      },
    }))
    document.cookie = 'csrftoken=test'
    renderElement(mountTuningPage().el)

    expect(await screen.findByText('Experiment 4')).toBeInTheDocument()
    const rubricBox = screen.getByLabelText('Rubric text')
    expect(rubricBox).not.toBeVisible()
    fireEvent.click(screen.getByText('Edit draft'))
    expect(rubricBox).toBeVisible()

    expect(rubricBox.value).toBe('Judge shouting.')
    expect(screen.getAllByLabelText('Criterion name').map((input) => input.value)).toEqual(['caps', 'insult'])
    fireEvent.input(rubricBox, { target: { value: 'Judge shouting at people.' } })
    fireEvent.input(screen.getByLabelText('Cutoff'), { target: { value: '70' } })
    fireEvent.click(screen.getByText('Run'))

    await waitFor(() => expect(sentDraft).not.toBeNull())
    expect(sentDraft).toMatchObject({ plugin: 'shouting', rubric_prompt: 'Judge shouting at people.', threshold: 70, criteria: CRITERIA })
  })

  it('shows one line per post, the wrong ones first, in plain words', async () => {
    showExperimentFour()

    expect(await screen.findByText('Experiment 4 on shouting')).toBeInTheDocument()
    expect(screen.getByText('1 right, 1 missed (should block, allowed), 0 wrongly blocked')).toBeInTheDocument()
    const lines = screen.getAllByRole('button', { expanded: false })
    expect(lines[0]).toHaveTextContent('wrong')
    expect(lines[0]).toHaveTextContent('you are all wrong and dumb')
    expect(lines[0]).toHaveTextContent('You: block')
    expect(lines[0]).toHaveTextContent('Draft: allow, 40/50')
    expect(lines[0]).not.toHaveTextContent('live:')
    expect(lines[1]).toHaveTextContent('right')
    // The live version is named only where it decides otherwise.
    expect(lines[1]).toHaveTextContent('Draft: allow, 0/50 (live: block)')
    expect(screen.getByText('1 right')).toBeInTheDocument()
  })

  it('opens a post with what it replies to and only the criteria that decided it', async () => {
    showExperimentFour()

    fireEvent.click(await screen.findByText('you are all wrong and dumb'))
    expect(screen.getByText('What do you think of my cat?')).toBeInTheDocument()
    expect(screen.getByText('X reply by sam')).toBeInTheDocument()
    expect(screen.getByText('Draft: allow, 40/50, because:')).toBeInTheDocument()
    expect(screen.getByText('It calls people dumb.')).toBeVisible()
    expect(screen.getByText('It is in lowercase.')).not.toBeVisible()
    fireEvent.click(screen.getByText('Show 1 unmet'))
    expect(screen.getByText('It is in lowercase.')).toBeVisible()
  })

  it('lists only the posts where the draft differs from live when asked', async () => {
    showExperimentFour()

    await screen.findByText('you are all wrong and dumb')
    fireEvent.click(screen.getByLabelText('Only where draft differs from live'))
    expect(screen.queryByText('you are all wrong and dumb')).toBeNull()
    expect(screen.getByText('GOOD MORNING EVERYONE')).toBeInTheDocument()
    expect(screen.getByText('The draft gets every one of these right.')).toBeInTheDocument()
  })

  it('flips the verdict of a thumbs from its opened post', async () => {
    let sentChange = null
    document.cookie = 'csrftoken=test'
    showExperimentFour({
      'PATCH /tuning/thumbs/8/': (options) => {
        sentChange = JSON.parse(options.body)
        return jsonResponse({ id: 8, verdict: 'wrong', details: '' })
      },
    })

    fireEvent.click(await screen.findByText('you are all wrong and dumb'))
    expect(screen.getByText('You said block.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Change to allow'))
    expect(await screen.findByText('Saved; the next run uses it.')).toBeInTheDocument()
    expect(sentChange).toEqual({ verdict: 'wrong' })
    expect(screen.getByText('You said allow.')).toBeInTheDocument()
    expect(screen.getByText('Change to block')).toBeInTheDocument()
  })

  it('tells everyone but the owner that the page is not for them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'You do not have permission.' }, 403)))
    renderElement(mountTuningPage().el)

    expect(await screen.findByText('The tuning page is only for the site owner, signed in with Google.')).toBeInTheDocument()
  })

  it('compares two experiments, listing the posts they decide differently', async () => {
    const looser = experiment({ id: 5, threshold: 50, results: [{ ...RUDE, draft: answer(60, ['caps']) }, CHEERFUL] })
    const stricter = experiment({ id: 6, threshold: 70, results: [{ ...RUDE, draft: answer(60, ['caps']) }, CHEERFUL] })
    vi.stubGlobal('fetch', fakeServer({
      'GET /tuning/experiments/5/': () => jsonResponse(looser),
      'GET /tuning/experiments/6/': () => jsonResponse(stricter),
    }))
    renderElement(mountTuningComparePage({ first: '5', second: '6' }).el)

    expect(await screen.findByText('1 posts decided differently, 1 the same.')).toBeInTheDocument()
    const line = screen.getByRole('button', { expanded: false })
    expect(line).toHaveTextContent('5 right')
    expect(line).toHaveTextContent('5: block, 60/50')
    expect(line).toHaveTextContent('6: allow, 60/70')
  })
})
