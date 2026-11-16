// Factory: returns a styled div for error or warning messages.
// Returns a hidden div (not null) when message is empty, so callers can always append it safely.

export function createErrorBanner(message, variant = 'error') {
  const el = document.createElement('div')
  if (!message) {
    el.className = 'hidden'
    return el
  }
  el.className = variant === 'warning'
    ? 'max-w-xl mx-auto mb-4 p-3 border border-amber-500/20 bg-amber-500/10 text-amber-400 rounded-lg text-sm text-center'
    : 'max-w-xl mx-auto mb-4 p-3 border border-red-500/20 bg-red-500/10 text-red-400 rounded-lg text-sm text-center'
  el.textContent = message
  return el
}
