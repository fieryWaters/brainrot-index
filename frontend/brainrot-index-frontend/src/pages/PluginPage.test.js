import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { mountPluginPage } from './PluginPage.js'
import { mountPublishPluginPage } from './PublishPluginPage.js'

const RUBRIC = 'Flag posts that are mostly crypto price predictions or token shilling.'

function pluginDetail(overrides) {
  return {
    slug: 'crypto-hype', name: 'Crypto hype', description: 'Hides crypto price hype.', author_name: 'Sam',
    is_baseline: false, is_listed: true, install_count: 3, rating_count: 0, average_rating: null, installed: true,
    rubric: RUBRIC, version: 1, default_threshold: 55, is_author: false, my_rating: null, reviews: [],
    samples: [{ platform: 'reddit', text: 'BTC to 1M by Friday', score: 90, label: 'flagged', reasoning: 'Price hype.' }],
    ...overrides,
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let requests
let detail

beforeEach(() => {
  requests = []
  detail = pluginDetail()
  document.cookie = 'csrftoken=test-csrf'
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = String(url)
    requests.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null })
    if (path.endsWith('/family/')) return jsonResponse({ role: 'admin', family: null })
    if (path.endsWith('/store/plugins/crypto-hype/')) return jsonResponse(detail)
    if (path.endsWith('/store/plugins/missing/')) return jsonResponse({ detail: 'Not found.' }, 404)
    if (path.endsWith('/store/try/')) return jsonResponse({ score: 85, label: 'flagged', reasoning: 'Token shilling.' })
    if (path.endsWith('/store/plugins/')) return jsonResponse({ name: ['A plugin with this name already exists.'] }, 400)
    return jsonResponse({})
  }))
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('PluginPage', () => {
  it('shows the rubric and a cached result', async () => {
    renderElement(mountPluginPage({ slug: 'crypto-hype' }).el)
    expect(await screen.findByText(RUBRIC)).toBeInTheDocument()
    expect(screen.getByText('BTC to 1M by Friday')).toBeInTheDocument()
    expect(screen.getByText('Score 90, flagged')).toBeInTheDocument()
  })

  it('saves a rating with a review', async () => {
    renderElement(mountPluginPage({ slug: 'crypto-hype' }).el)
    fireEvent.change(await screen.findByLabelText('Your rating'), { target: { value: '4' } })
    fireEvent.input(screen.getByLabelText('Your review'), { target: { value: 'Catches most shilling.' } })
    fireEvent.click(screen.getByText('Save rating'))
    await waitFor(() => expect(requests).toContainEqual({
      path: '/api/store/plugins/crypto-hype/rating/', method: 'PUT', body: { stars: 4, review: 'Catches most shilling.' },
    }))
  })

  it('asks to install before rating', async () => {
    detail = pluginDetail({ installed: false })
    renderElement(mountPluginPage({ slug: 'crypto-hype' }).el)
    expect(await screen.findByText('Install this plugin to rate it.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Your rating')).not.toBeInTheDocument()
  })

  it('lets the author publish a new version', async () => {
    detail = pluginDetail({ is_author: true })
    renderElement(mountPluginPage({ slug: 'crypto-hype' }).el)
    fireEvent.click(await screen.findByText('Publish version 2'))
    await waitFor(() => expect(requests).toContainEqual({
      path: '/api/store/plugins/crypto-hype/versions/', method: 'POST', body: { rubric: RUBRIC },
    }))
  })

  it('says so when the plugin is not in the store', async () => {
    renderElement(mountPluginPage({ slug: 'missing' }).el)
    expect(await screen.findByText('This plugin is not in the store.')).toBeInTheDocument()
  })
})

describe('PublishPluginPage', () => {
  it('tries the draft rubric on pasted text and shows the score', async () => {
    renderElement(mountPublishPluginPage().el)
    fireEvent.input(screen.getByLabelText('Rubric'), { target: { value: RUBRIC } })
    fireEvent.input(screen.getByLabelText('Post text to try'), { target: { value: 'Buy this coin now' } })
    fireEvent.click(screen.getByText('Try it', { selector: 'button' }))
    await waitFor(() => expect(requests).toContainEqual({
      path: '/api/store/try/', method: 'POST', body: { rubric: RUBRIC, text: 'Buy this coin now', platform: 'reddit' },
    }))
    expect(await screen.findByText('Score 85 out of 100, labeled flagged')).toBeInTheDocument()
  })

  it('shows the reason a publish was refused', async () => {
    renderElement(mountPublishPluginPage().el)
    fireEvent.click(screen.getByText('Publish'))
    expect(await screen.findByText('A plugin with this name already exists.')).toBeInTheDocument()
  })
})
