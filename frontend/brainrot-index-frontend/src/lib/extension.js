// Talking to the Brainrot Index extension in this browser. Its content script
// on this site answers a ping, and also announces itself once when it starts,
// in case the page asked before it was ready. The announcement carries the
// extension's account state; an extension older than 0.2.0 sends none.

import { apiFetch } from './api.js'
import { getState, subscribe } from './auth.js'

export const PING_MESSAGE_TYPE = 'brainrot-index-extension-ping'
export const PRESENT_MESSAGE_TYPE = 'brainrot-index-extension-present'
export const TOKEN_MESSAGE_TYPE = 'brainrot-index-extension-token'
export const CONNECTED_MESSAGE_TYPE = 'brainrot-index-extension-connected'
// The extension holds the token but sends nothing until the person agrees on its consent screen.
export const CONSENT_NEEDED_MESSAGE_TYPE = 'brainrot-index-extension-consent-needed'

// The extension has no token, or the server refused the one it had.
export const NOT_CONNECTED_STATE = 'not-connected'
// The extension sends nothing, and asks for no token, until the person agrees on its consent screen.
export const CONSENT_NEEDED_STATE = 'consent-needed'

export function pingExtension() {
  window.postMessage({ type: PING_MESSAGE_TYPE }, window.location.origin)
}

// Calls onPresent(accountState) once if the extension answers. Returns a function that stops listening.
export function detectExtension(onPresent) {
  function handleMessage(event) {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== PRESENT_MESSAGE_TYPE) return
    window.removeEventListener('message', handleMessage)
    onPresent(event.data.accountState)
  }
  window.addEventListener('message', handleMessage)
  pingExtension()
  return () => window.removeEventListener('message', handleMessage)
}

// Creates a token for the signed-in account and hands it to the extension's
// content script on this page. Answers 'handed-over', 'email-not-verified' or 'failed'.
export async function handTokenToExtension() {
  const { response, data } = await apiFetch('/extension/token/', { method: 'POST' })
  if (data.code === 'email_not_verified') return 'email-not-verified'
  if (!response.ok) return 'failed'
  window.postMessage({ type: TOKEN_MESSAGE_TYPE, token: data.token }, window.location.origin)
  return 'handed-over'
}

// On every page of the site: when the extension says it is not connected and
// someone is signed in, connect it to their account, at most once per page
// load. Someone who signs in on this page is connected right away.
// Returns a function that stops it.
export function connectExtensionAutomatically() {
  let tokenRequested = false
  function handleMessage(event) {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== PRESENT_MESSAGE_TYPE) return
    if (event.data.accountState !== NOT_CONNECTED_STATE) return
    if (!getState().isAuthenticated) return
    if (tokenRequested) return
    tokenRequested = true
    handTokenToExtension()
  }
  window.addEventListener('message', handleMessage)

  let wasSignedIn = getState().isAuthenticated
  const unsubscribe = subscribe((state) => {
    if (state.isAuthenticated && !wasSignedIn) pingExtension()
    wasSignedIn = state.isAuthenticated
  })

  return () => {
    window.removeEventListener('message', handleMessage)
    unsubscribe()
  }
}
