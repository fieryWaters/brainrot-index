// Factory: renders a Google Sign-In button using the GSI library.
// The GSI script is added to the page the first time a button is needed, so
// pages without one make no request to Google, and it loads asynchronously, so
// we poll until window.google.accounts.id is ready.
// Returns { el, destroy() } so the caller can clean up the timeout.

import { GOOGLE_CLIENT_ID, handleGoogleCredential } from '../lib/auth.js'

const GSI_SCRIPT_URL = 'https://accounts.google.com/gsi/client'

let gsiInitialized = false

function loadGsiScript() {
  if (document.querySelector(`script[src="${GSI_SCRIPT_URL}"]`)) return
  const script = document.createElement('script')
  script.src = GSI_SCRIPT_URL
  script.async = true
  document.head.appendChild(script)
}

export function createGoogleSignIn() {
  const div = document.createElement('div')
  div.className = 'min-w-[120px]'
  loadGsiScript()

  let attempts = 0
  const maxAttempts = 40
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
