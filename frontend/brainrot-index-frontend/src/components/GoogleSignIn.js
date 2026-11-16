// Factory: renders a Google Sign-In button using the GSI library.
// The GSI script loads asynchronously, so we poll until window.google.accounts.id is ready.
// Returns { el, destroy() } so the caller can clean up the timeout.

import { GOOGLE_CLIENT_ID, handleGoogleCredential } from '../lib/auth.js'

let gsiInitialized = false

export function createGoogleSignIn() {
  const div = document.createElement('div')
  div.className = 'min-w-[120px]'

  let attempts = 0
  const maxAttempts = 20
  let timeoutId = null

  const tryRender = () => {
    const gsi = window.google?.accounts?.id
    if (!gsi || !div.isConnected) {
      attempts++
      if (attempts < maxAttempts) {
        timeoutId = setTimeout(tryRender, 250)
      }
      return
    }

    if (!gsiInitialized) {
      gsi.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCredential,
        auto_select: false,
      })
      gsiInitialized = true
    }

    div.innerHTML = ''
    gsi.renderButton(div, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
    })
  }

  // Start polling once the element is in the DOM (caller must append el first)
  timeoutId = setTimeout(tryRender, 0)

  return {
    el: div,
    destroy() {
      if (timeoutId) clearTimeout(timeoutId)
      div.innerHTML = ''
      try { window.google?.accounts?.id?.cancel?.() } catch {
        // The Google SDK may not be present during teardown.
      }
      gsiInitialized = false
    },
  }
}
