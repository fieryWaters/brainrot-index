// Whether the Brainrot Index extension is installed in this browser. Its
// content script on this site answers a ping, and also announces itself once
// when it starts, in case the page asked before it was ready.

export const PING_MESSAGE_TYPE = 'brainrot-index-extension-ping'
export const PRESENT_MESSAGE_TYPE = 'brainrot-index-extension-present'

// Calls onPresent once if the extension answers. Returns a function that stops listening.
export function detectExtension(onPresent) {
  function handleMessage(event) {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== PRESENT_MESSAGE_TYPE) return
    window.removeEventListener('message', handleMessage)
    onPresent()
  }
  window.addEventListener('message', handleMessage)
  window.postMessage({ type: PING_MESSAGE_TYPE }, window.location.origin)
  return () => window.removeEventListener('message', handleMessage)
}
