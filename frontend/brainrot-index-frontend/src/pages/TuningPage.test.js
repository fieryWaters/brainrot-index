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

function experiment(overrides = {}) {
  return {
    id: 4, plugin: 'shouting', created_at: '2026-11-20T10:00:00+00:00', finished_at: '2026-11-20T10:01:00+00:00',
    status: 'done', error: '', live_version: 1, live_threshold: 50, started_from: null, threshold: 50,
    include_synthetic: false, explain_every_case: false, model: 'test/model', inference_source: 'openrouter',
    total_cases: 1, judged_cases: 1,
    scores: { thumb: { cases: 1, draft: { right: 1, missed: 0, wrongly_flagged: 0, failed: 0 }, live: { right: 0, missed: 0, wrongly_flagged: 1, failed: 0 } } },
    prompt_tokens: 2700, completion_tokens: 180, cost: 0.0004,
    rubric_prompt: 'Judge shouting at people.', criteria: CRITERIA,
    live_rubric_prompt: 'Judge shouting.', live_criteria: CRITERIA,
    results: [{
      case_id: 'judgment-7', source: 'thumb', judgment_id: 7, description: 'Text:\nGOOD MORNING EVERYONE',
      image_urls: [], post_url: 'https://x.com/a/status/1', should_flag: false,
      owner: { verdict: 'wrong', shown_action: 'hide', plugin: 'shouting', details: 'Just cheerful.' },
      video_not_watched: false, draft: answer(0, []), live: answer(60, ['caps']), live_reused: false,
      explanations: { caps: 'It greets people.', insult: 'Nobody is insulted.' },
    }],
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

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('TuningPage', () => {
  it('starts the draft from the live rubric and runs it as an experiment', async () => {
    let sentDraft = null
    vi.stubGlobal('fetch', fakeServer({
      'GET /tuning/filters/': () => jsonResponse(FILTERS),
      'GET /tuning/experiments/?plugin=shouting': () => jsonResponse({ experiments: [] }),
      'POST /tuning/experiments/': (options) => {
        sentDraft = JSON.parse(options.body)
        return jsonResponse(experiment({ id: 5, status: 'pending' }), 201)
      },
    }))
    document.cookie = 'csrftoken=test'
    renderElement(mountTuningPage().el)

    const rubricBox = await screen.findByLabelText('Rubric text')
    expect(rubricBox.value).toBe('Judge shouting.')
    expect(screen.getAllByLabelText('Criterion name').map((input) => input.value)).toEqual(['caps', 'insult'])
    fireEvent.input(rubricBox, { target: { value: 'Judge shouting at people.' } })
    fireEvent.input(screen.getByLabelText('Cutoff'), { target: { value: '70' } })
    fireEvent.click(screen.getByText('Run'))

    await waitFor(() => expect(sentDraft).not.toBeNull())
    expect(sentDraft).toMatchObject({ plugin: 'shouting', rubric_prompt: 'Judge shouting at people.', threshold: 70, criteria: CRITERIA })
  })

  it('shows an experiment with each post, the owner, both decisions and the explanation', async () => {
    vi.stubGlobal('fetch', fakeServer({
      'GET /tuning/filters/': () => jsonResponse(FILTERS),
      'GET /tuning/experiments/4/': () => jsonResponse(experiment()),
      'GET /tuning/experiments/?plugin=shouting': () => jsonResponse({ experiments: [experiment()] }),
    }))
    renderElement(mountTuningPage({ experimentId: '4' }).el)

    expect(await screen.findByText('Experiment 4 on shouting')).toBeInTheDocument()
    expect(screen.getByText('Draft, cutoff 50: 1 of 1 right (0 missed, 0 wrongly flagged)')).toBeInTheDocument()
    expect(screen.getByText('Text:\nGOOD MORNING EVERYONE', { normalizer: (text) => text })).toBeInTheDocument()
    expect(screen.getByText('Just cheerful.')).toBeInTheDocument()
    expect(screen.getByText('0/50 allow')).toBeInTheDocument()
    expect(screen.getByText('60/50 flag')).toBeInTheDocument()
    expect(screen.getByText('It greets people.')).toBeInTheDocument()
    expect(screen.getByText(/Started from live v1\. test\/model \(openrouter\)\. 2880 tokens, \$0\.0004\./)).toBeInTheDocument()
    // The experiment's draft is loaded for further editing.
    expect(screen.getByLabelText('Rubric text').value).toBe('Judge shouting at people.')
  })

  it('changes the verdict of a thumbs from its row', async () => {
    let sentChange = null
    vi.stubGlobal('fetch', fakeServer({
      'GET /tuning/filters/': () => jsonResponse(FILTERS),
      'GET /tuning/experiments/4/': () => jsonResponse(experiment()),
      'GET /tuning/experiments/?plugin=shouting': () => jsonResponse({ experiments: [] }),
      'PATCH /tuning/thumbs/7/': (options) => {
        sentChange = JSON.parse(options.body)
        return jsonResponse({ id: 7, verdict: 'right', details: 'Just cheerful.' })
      },
    }))
    document.cookie = 'csrftoken=test'
    renderElement(mountTuningPage({ experimentId: '4' }).el)

    fireEvent.click(await screen.findByText('Make it thumbs up'))
    expect(await screen.findByText('Now thumbs up; the next run uses it.')).toBeInTheDocument()
    expect(sentChange).toEqual({ verdict: 'right' })
    expect(screen.getByText('Make it thumbs down')).toBeInTheDocument()
  })

  it('tells everyone but the owner that the page is not for them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'You do not have permission.' }, 403)))
    renderElement(mountTuningPage().el)

    expect(await screen.findByText('The tuning page is only for the site owner, signed in with Google.')).toBeInTheDocument()
  })

  it('compares two experiments, listing the posts they decide differently', async () => {
    const stricter = experiment({ id: 6, threshold: 70, results: [{ ...experiment().results[0], draft: answer(60, ['caps']) }] })
    const looser = experiment({ id: 5, threshold: 50, results: [{ ...experiment().results[0], draft: answer(60, ['caps']) }] })
    vi.stubGlobal('fetch', fakeServer({
      'GET /tuning/experiments/5/': () => jsonResponse(looser),
      'GET /tuning/experiments/6/': () => jsonResponse(stricter),
    }))
    renderElement(mountTuningComparePage({ first: '5', second: '6' }).el)

    expect(await screen.findByText('1 posts decided differently, 0 the same.')).toBeInTheDocument()
    expect(screen.getByText('60/50 flag')).toBeInTheDocument()
    expect(screen.getByText('60/70 allow')).toBeInTheDocument()
  })
})
