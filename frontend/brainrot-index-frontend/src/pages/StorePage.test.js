import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { mountStorePage, SEARCH_DELAY_MS } from './StorePage.js'

function storePlugin(overrides) {
  return {
    slug: 'crypto-hype', name: 'Crypto hype', description: 'Hides crypto price hype.', author_name: 'Sam',
    is_baseline: false, is_listed: true, install_count: 3, rating_count: 2, average_rating: 4.5, installed: false,
    ...overrides,
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let requests
let role

beforeEach(() => {
  requests = []
  role = 'superadmin'
  document.cookie = 'csrftoken=test-csrf'
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = String(url)
    requests.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null })
    if (path.endsWith('/family/')) return jsonResponse({ role, family: null })
    if (path.includes('/store/plugins/?q=nothing')) return jsonResponse({ plugins: [] })
    if (path.includes('/store/plugins/')) return jsonResponse({ plugins: [storePlugin()] })
    if (path.endsWith('/plugins/') && options.method === 'POST') return jsonResponse({}, 201)
    return jsonResponse({})
  }))
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('StorePage', () => {
  it('lists plugins with author, installs and rating', async () => {
    renderElement(mountStorePage().el)
    expect(await screen.findByText('Crypto hype')).toBeInTheDocument()
    expect(screen.getByText('by Sam')).toBeInTheDocument()
    expect(screen.getByText('3 installs - 4.5 out of 5 from 2 ratings')).toBeInTheDocument()
    expect(screen.getByText('Publish a plugin')).toBeInTheDocument()
  })

  it('installs a plugin and counts the install', async () => {
    renderElement(mountStorePage().el)
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }))
    await waitFor(() => expect(requests).toContainEqual({ path: '/api/plugins/', method: 'POST', body: { slug: 'crypto-hype' } }))
    expect(await screen.findByRole('button', { name: 'Uninstall' })).toBeInTheDocument()
    expect(screen.getByText('4 installs - 4.5 out of 5 from 2 ratings')).toBeInTheDocument()
  })

  it('says so when a search finds nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderElement(mountStorePage().el)
    await screen.findByText('Crypto hype')
    fireEvent.input(screen.getByLabelText('Search plugins'), { target: { value: 'nothing' } })
    await vi.advanceTimersByTimeAsync(SEARCH_DELAY_MS + 50)
    expect(await screen.findByText('No plugins match "nothing".')).toBeInTheDocument()
  })

  it('shows a child the store without install or publish buttons', async () => {
    role = 'child'
    renderElement(mountStorePage().el)
    expect(await screen.findByText('Crypto hype')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument()
    expect(screen.queryByText('Publish a plugin')).not.toBeInTheDocument()
  })
})
