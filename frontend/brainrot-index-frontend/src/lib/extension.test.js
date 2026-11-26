import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { waitFor } from '@testing-library/dom'
import { _resetForTesting, refreshSession } from './auth.js'
import { connectExtensionAutomatically, PING_MESSAGE_TYPE, PRESENT_MESSAGE_TYPE, TOKEN_MESSAGE_TYPE } from './extension.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function announceExtension(accountState) {
  window.dispatchEvent(new MessageEvent('message', {
    data: { type: PRESENT_MESSAGE_TYPE, accountState },
    origin: window.location.origin,
  }))
}

let signedIn
let tokenRequests
let stopConnecting

beforeEach(() => {
  _resetForTesting()
  signedIn = true
  tokenRequests = 0
  document.cookie = 'csrftoken=test-csrf'
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const path = String(url)
    if (path.endsWith('/auth/me/')) {
      if (signedIn) return jsonResponse({ email: 'reader@example.com', email_verified: true })
      return jsonResponse({ detail: 'Not signed in.' }, 403)
    }
    if (path.endsWith('/extension/token/')) {
      tokenRequests += 1
      return jsonResponse({ token: 'raw-token' }, 201)
    }
    return jsonResponse({})
  }))
})

afterEach(() => {
  stopConnecting()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('connectExtensionAutomatically', () => {
  it('hands a token to an extension that is not connected while someone is signed in', async () => {
    await refreshSession()
    const postMessage = vi.spyOn(window, 'postMessage')
    stopConnecting = connectExtensionAutomatically()

    announceExtension('not-connected')

    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      { type: TOKEN_MESSAGE_TYPE, token: 'raw-token' }, window.location.origin))
  })

  it('creates at most one token per page load', async () => {
    await refreshSession()
    stopConnecting = connectExtensionAutomatically()

    announceExtension('not-connected')
    announceExtension('not-connected')

    await waitFor(() => expect(tokenRequests).toBe(1))
  })

  it('leaves alone an extension that is connected, waits for consent, or is older than 0.2.0', async () => {
    await refreshSession()
    stopConnecting = connectExtensionAutomatically()

    announceExtension('connected')
    announceExtension('consent-needed')
    announceExtension(undefined)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(tokenRequests).toBe(0)
  })

  it('creates no token while nobody is signed in, and asks the extension again on sign-in', async () => {
    signedIn = false
    await refreshSession()
    const postMessage = vi.spyOn(window, 'postMessage')
    stopConnecting = connectExtensionAutomatically()

    announceExtension('not-connected')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(tokenRequests).toBe(0)

    signedIn = true
    await refreshSession()
    expect(postMessage).toHaveBeenCalledWith({ type: PING_MESSAGE_TYPE }, window.location.origin)

    announceExtension('not-connected')
    await waitFor(() => expect(tokenRequests).toBe(1))
  })
})
