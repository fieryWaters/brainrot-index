// Shared chrome for the pages Stripe Checkout returns to. Owns session_id
// parsing, the loading skeleton, the error card, and the success layout. Each
// page supplies its status endpoint, error-button target, and a
// buildSuccess(data, sessionId) that runs follow-up work (such as a session
// refresh) and returns the copy:
//   { heading, emailPrefix, emailFallback, rows: [[label, value, valueClass?]],
//     actions: [{ label, path, primary? }] }
import { apiFetch } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { navigate } from '../lib/router.js'

const CHECK_ICON_SVG = `
  <svg class="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
  </svg>
`

function navButton(label, path, primary = false) {
  const button = el('button',
    primary
      ? 'px-6 py-3 rounded-xl bg-gradient-to-r from-shield-400 to-shield-600 hover:to-shield-400 hover:shadow-lg hover:shadow-glow-400/20 text-white font-bold transition-all'
      : 'px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 transition-colors font-medium',
    label)
  button.addEventListener('click', () => navigate(path))
  return button
}

export function mountConfirmationPage({ statusEndpoint, errorBack, buildSuccess }) {
  const outer = el('div', 'max-w-2xl mx-auto px-4 py-16 text-center')

  const sessionId = new URLSearchParams(window.location.search).get('session_id')
  if (!sessionId) {
    outer.append(
      el('h1', 'text-2xl font-bold mb-4', 'No session found'),
      el('p', 'text-white/50', 'Missing checkout session. Please try again.'),
    )
    return { el: outer }
  }

  // The worker confirms payment asynchronously, so poll until the row is
  // terminal. 'processing' keeps this finalizing skeleton up; 'complete' shows
  // the receipt; anything else (or a failed request) shows the error card.
  function showFinalizing() {
    outer.innerHTML = `
      <div class="animate-pulse">
        <div class="w-16 h-16 mx-auto mb-6 rounded-full bg-white/10"></div>
        <div class="h-6 bg-white/10 rounded w-48 mx-auto mb-3"></div>
        <div class="h-4 bg-white/10 rounded w-64 mx-auto"></div>
      </div>
      <p class="text-white/50 mt-6">Finalizing your payment...</p>
    `
  }

  function showError() {
    outer.replaceChildren(
      el('div', 'text-6xl mb-6', '!'),
      el('h1', 'text-2xl font-bold mb-4', 'Something went wrong'),
      el('p', 'text-white/50 mb-8',
        'Your payment may still be processing. Check your email for confirmation.'),
      navButton(errorBack.label, errorBack.path),
    )
  }

  async function showSuccess(data) {
    const { heading, emailPrefix, emailFallback, rows, actions } = await buildSuccess(data, sessionId)

    const emailLine = el('p', 'text-white/50 mb-6')
    if (data.customer_email) {
      emailLine.append(emailPrefix, el('strong', 'text-white/70', data.customer_email), '.')
    } else {
      emailLine.textContent = emailFallback
    }

    const checkIcon = el('div',
      'w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center')
    checkIcon.innerHTML = CHECK_ICON_SVG

    outer.replaceChildren(
      checkIcon,
      el('h1', 'text-2xl font-bold mb-2', heading),
      emailLine,
      el('div', 'rounded-xl border border-white/10 bg-navy-900 p-5 text-left mb-8 space-y-2',
        ...rows.map(([label, value, valueClass = '']) =>
          el('div', 'flex justify-between',
            el('span', 'text-white/50', label),
            el('span', valueClass, value)))),
      el('div', 'flex gap-4 justify-center',
        ...actions.map((action) => navButton(action.label, action.path, action.primary))),
    )
  }

  async function poll() {
    const { response, data } = await apiFetch(`${statusEndpoint}?session_id=${encodeURIComponent(sessionId)}`)
    if (!response.ok) return showError()
    if (data.status === 'processing') return void setTimeout(poll, 2500)
    if (data.status === 'complete') return showSuccess(data)
    showError()
  }

  showFinalizing()
  poll()

  return { el: outer }
}
