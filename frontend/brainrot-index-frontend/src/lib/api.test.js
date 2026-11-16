import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiFetch } from './api'

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('makes GET request by default', async () => {
    const mockResponse = { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const { response, data } = await apiFetch('/test/')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/test/'),
      expect.objectContaining({ method: 'GET' })
    )
    expect(response.ok).toBe(true)
    expect(data.ok).toBe(true)
  })

  it('sends cookies with credentials: include', async () => {
    const mockResponse = { ok: true, status: 200, json: () => Promise.resolve({}) }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    await apiFetch('/test/')
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('sends JSON body with Content-Type header', async () => {
    const mockResponse = { ok: true, status: 200, json: () => Promise.resolve({}) }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    await apiFetch('/test/', { method: 'POST', body: { foo: 'bar' } })
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ foo: 'bar' }),
      })
    )
  })

  it('sends FormData body without Content-Type', async () => {
    const mockResponse = { ok: true, status: 200, json: () => Promise.resolve({}) }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const formData = new FormData()
    formData.append('file', 'test')
    await apiFetch('/test/', { method: 'POST', body: formData })

    // apiFetch may first call fetch() for the CSRF bootstrap on unsafe methods,
    // so the real request is the last recorded call.
    const callHeaders = fetch.mock.calls.at(-1)[1].headers
    expect(callHeaders['Content-Type']).toBeUndefined()
  })

  it('handles JSON parse failure gracefully', async () => {
    const mockResponse = { ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const { data } = await apiFetch('/test/')
    expect(data).toEqual({})
  })
})
