// The pages Stripe Checkout returns to. The success page asks the backend to
// read the finished Checkout session from Stripe, so the subscription is
// active as soon as the page loads, with or without the webhook.

import { apiFetch } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { billingSummary } from '../components/BillingCard.js'

const DASHBOARD_LINK_CLASS = 'inline-block px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black transition-all'

function dashboardLink() {
  const link = el('a', DASHBOARD_LINK_CLASS, 'Go to dashboard')
  link.href = '/dashboard'
  return link
}

export function mountBillingSuccessPage() {
  const container = el('div', 'max-w-2xl mx-auto px-4 py-16 text-center')
  const heading = el('h1', 'text-2xl font-bold mb-4 text-white', 'Confirming your subscription...')
  const detail = el('p', 'text-white/60 mb-8')
  container.append(heading, detail)

  const sessionId = new URLSearchParams(window.location.search).get('session_id') || ''
  apiFetch('/billing/checkout/reconcile/', { method: 'POST', body: { session_id: sessionId } })
    .then(({ response, data }) => {
      if (response.ok && data.has_access) {
        heading.textContent = 'You are subscribed'
        detail.textContent = billingSummary(data)
      } else {
        heading.textContent = 'We could not confirm the payment yet'
        detail.textContent = 'If you finished paying, the dashboard will show it within a minute.'
      }
      container.append(dashboardLink())
    })

  return { el: container }
}

export function mountBillingCanceledPage() {
  return {
    el: el('div', 'max-w-2xl mx-auto px-4 py-16 text-center',
      el('h1', 'text-2xl font-bold mb-4 text-white', 'No payment was made'),
      el('p', 'text-white/60 mb-8', 'You can subscribe any time from the dashboard.'),
      dashboardLink()),
  }
}
