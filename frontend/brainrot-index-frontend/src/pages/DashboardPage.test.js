import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { mountDashboardPage, TOKEN_MESSAGE_TYPE, CONNECTED_MESSAGE_TYPE, CONSENT_NEEDED_MESSAGE_TYPE, EXTENSION_ANSWER_TIMEOUT_MS } from './DashboardPage.js'

const PLUGINS = [
  { slug: 'ragebait', name: 'Ragebait', description: 'Made to make you angry.', enabled: true, threshold: 60, flagged_action: 'hide' },
]

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let requests
let role

beforeEach(() => {
  requests = []
  role = 'admin'
  document.cookie = 'csrftoken=test-csrf'
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = String(url)
    requests.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null })
    if (path.endsWith('/family/')) return jsonResponse({ role, family: null })
    if (path.endsWith('/settings/') && options.method === 'GET') return jsonResponse({ enabled: true, mode: 'adult', allow_reveal: true })
    if (path.endsWith('/plugins/ragebait/') && options.body?.includes('"enabled":true')) {
      return jsonResponse({ error: 'At most 8 plugins can be on at once, because each one checks every post. Turn one off first.' }, 400)
    }
    if (path.endsWith('/plugins/ragebait/') && options.method === 'DELETE') return new Response(null, { status: 204 })
    if (path.endsWith('/plugins/')) {
      const plugins = requests.some((request) => request.method === 'DELETE') ? [] : PLUGINS
      return jsonResponse({ plugins: structuredClone(plugins), enabled_limit: 8, can_change: role !== 'child' })
    }
    if (path.endsWith('/extension/token/')) return jsonResponse({ token: 'raw-token' }, 201)
    return jsonResponse({})
  }))
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('DashboardPage', () => {
  it('shows one row per installed plugin with its threshold in plain words', async () => {
    renderElement(mountDashboardPage().el)
    expect(await screen.findByText('Ragebait')).toBeInTheDocument()
    expect(screen.getByText('Filter posts that score 60 or more out of 100')).toBeInTheDocument()
    expect(screen.getByText('Stricter')).toBeInTheDocument()
  })

  it('offers no choice of blurring: a flagged post is always hidden', async () => {
    renderElement(mountDashboardPage().el)
    expect(await screen.findByText('Ragebait')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ragebait action')).toBeNull()
    expect(screen.queryByText('Blur')).toBeNull()
  })

  it('saves a threshold change immediately', async () => {
    renderElement(mountDashboardPage().el)
    const slider = await screen.findByLabelText('Ragebait threshold')
    fireEvent.input(slider, { target: { value: '35' } })
    expect(screen.getByText('Filter posts that score 35 or more out of 100')).toBeInTheDocument()
    fireEvent.change(slider)

    await waitFor(() => expect(requests).toContainEqual({ path: '/api/plugins/ragebait/', method: 'PATCH', body: { threshold: 35 } }))
  })

  it('saves the master switch and mode', async () => {
    renderElement(mountDashboardPage().el)
    fireEvent.click(await screen.findByLabelText('Filtering on'))
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'child' } })

    await waitFor(() => {
      expect(requests).toContainEqual({ path: '/api/settings/', method: 'PATCH', body: { enabled: false } })
      expect(requests).toContainEqual({ path: '/api/settings/', method: 'PATCH', body: { mode: 'child' } })
    })
  })

  it('shows how many plugins are on out of the limit', async () => {
    renderElement(mountDashboardPage().el)
    expect(await screen.findByText(/^1 of 8 turned on/)).toBeInTheDocument()
  })

  it('keeps a plugin off and shows the reason when the limit is reached', async () => {
    PLUGINS[0].enabled = false
    try {
      renderElement(mountDashboardPage().el)
      const checkbox = await screen.findByLabelText('Ragebait on')
      fireEvent.click(checkbox)
      expect(await screen.findByText('At most 8 plugins can be on at once, because each one checks every post. Turn one off first.')).toBeInTheDocument()
      expect(checkbox.checked).toBe(false)
    } finally {
      PLUGINS[0].enabled = true
    }
  })

  it('uninstalls a plugin and then says nothing is filtered', async () => {
    renderElement(mountDashboardPage().el)
    fireEvent.click(await screen.findByText('Uninstall'))
    expect(await screen.findByText('No plugins installed, so nothing is filtered.')).toBeInTheDocument()
  })

  it('shows a child their settings with every control disabled', async () => {
    role = 'child'
    renderElement(mountDashboardPage().el)
    expect(await screen.findByLabelText('Ragebait threshold')).toBeDisabled()
    expect(screen.getByLabelText('Mode')).toBeDisabled()
    expect(screen.getAllByText('An admin of your family manages these settings.').length).toBe(2)
    expect(screen.queryByText('Uninstall')).not.toBeInTheDocument()
  })

  it('hands the token to the extension and shows Connected when it answers', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    renderElement(mountDashboardPage().el)
    fireEvent.click(screen.getByText('Connect extension'))

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { type: TOKEN_MESSAGE_TYPE, token: 'raw-token' }, window.location.origin))

    window.dispatchEvent(new MessageEvent('message', { data: { type: CONNECTED_MESSAGE_TYPE }, origin: window.location.origin }))
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('points to the extension consent tab when the extension needs agreement first', async () => {
    renderElement(mountDashboardPage().el)
    fireEvent.click(screen.getByText('Connect extension'))
    await waitFor(() => expect(requests.some((request) => request.path.endsWith('/extension/token/'))).toBe(true))

    window.dispatchEvent(new MessageEvent('message', { data: { type: CONSENT_NEEDED_MESSAGE_TYPE }, origin: window.location.origin }))
    expect(screen.getByText(/Press Agree and continue there/)).toBeInTheDocument()
  })

  it('asks an unverified reader to verify their email instead of connecting', async () => {
    const postMessage = vi.spyOn(window, 'postMessage')
    fetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/extension/token/')) {
        return jsonResponse({ detail: 'Verify your email first.', code: 'email_not_verified' }, 403)
      }
      return jsonResponse({ plugins: [] })
    })
    renderElement(mountDashboardPage().el)
    fireEvent.click(screen.getByText('Connect extension'))

    expect(await screen.findByText(/Verify your email first/)).toBeInTheDocument()
    expect(postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: TOKEN_MESSAGE_TYPE }), expect.anything())
  })

  it('tells the reader to reload the page when the extension does not answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderElement(mountDashboardPage().el)
    fireEvent.click(screen.getByText('Connect extension'))
    await waitFor(() => expect(requests.some((request) => request.path.endsWith('/extension/token/'))).toBe(true))
    await vi.advanceTimersByTimeAsync(EXTENSION_ANSWER_TIMEOUT_MS + 100)

    expect(screen.getByText('The extension did not answer on this page. If you just installed or reloaded it, reload this page and press Connect extension again.')).toBeInTheDocument()
  })

  it('points to the install page until the extension answers on this page', async () => {
    renderElement(mountDashboardPage().el)
    expect(screen.getByText('Install it first').getAttribute('href')).toBe('/install')

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'brainrot-index-extension-present' }, origin: window.location.origin }))
    expect(screen.getByText('Link the extension in this browser to your account.')).toBeInTheDocument()
  })
})
