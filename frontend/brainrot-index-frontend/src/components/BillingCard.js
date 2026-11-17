// Dashboard card for the subscription: trial days left or the plan's state,
// and a button to subscribe (Stripe Checkout) or manage (Stripe Customer Portal).

import { apiFetch } from '../lib/api.js'
import { el } from '../lib/dom.js'

export const PRICE_TEXT = '$5 per month'
export const TRIAL_ENDED_TEXT = 'Your free trial has ended. Subscribe to continue.'

const CARD_CLASS = 'rounded-2xl border border-white/10 bg-black/30 p-6 mb-6'
const PRIMARY_BUTTON_CLASS = 'shrink-0 px-4 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-shield-400 to-shield-600 hover:to-shield-400 hover:shadow-lg hover:shadow-glow-400/20 text-white transition-all disabled:opacity-60'
const ACCENT_BUTTON_CLASS = 'shrink-0 px-4 py-2 rounded-lg text-sm font-semibold bg-shield-400/25 hover:bg-shield-400/40 text-glow-300 transition-colors disabled:opacity-60'

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function daysText(days) {
  if (days === 1) return '1 day'
  return `${days} days`
}

// One sentence describing where the account stands.
export function billingSummary(billing) {
  if (billing.comp) return 'Free forever on this account.'
  if (!billing.has_access && billing.status === 'canceled') return 'Your subscription has ended. Subscribe to continue.'
  if (!billing.has_access) return TRIAL_ENDED_TEXT
  if (billing.trial_days_left !== null) {
    return `Free trial: ${daysText(billing.trial_days_left)} left. Then ${PRICE_TEXT}.`
  }
  if (billing.cancel_at_period_end) {
    return `Canceled. Filtering keeps working until ${formatDate(billing.current_period_end)}.`
  }
  if (billing.status === 'trialing') {
    return `Subscribed. Free until ${formatDate(billing.current_period_end)}, then ${PRICE_TEXT}.`
  }
  if (billing.status === 'past_due') {
    return 'The last payment failed. Update your card to keep filtering.'
  }
  return `Subscribed, ${PRICE_TEXT}. Renews ${formatDate(billing.current_period_end)}.`
}

// Subscribed accounts manage their plan in the Customer Portal; everyone else subscribes.
function hasLiveSubscription(billing) {
  return billing.can_manage && billing.has_access && billing.trial_days_left === null
}

async function openStripePage(button, endpoint, statusLine) {
  button.disabled = true
  const { response, data } = await apiFetch(endpoint, { method: 'POST' })
  if (response.ok && data.url) {
    window.location.assign(data.url)
    return
  }
  button.disabled = false
  statusLine.textContent = data.error || 'Could not open the payment page. Please try again.'
}

export function createBillingCard(billing) {
  const statusLine = el('p', 'text-sm text-white/50 mt-2')
  const summary = el('p', billing.has_access ? 'text-sm text-white/70' : 'text-sm text-amber-300 font-semibold',
    billingSummary(billing))

  let button = null
  if (!billing.comp) {
    if (hasLiveSubscription(billing)) {
      button = el('button', ACCENT_BUTTON_CLASS, 'Manage subscription')
      button.addEventListener('click', () => openStripePage(button, '/billing/portal/', statusLine))
    } else {
      button = el('button', PRIMARY_BUTTON_CLASS, 'Subscribe')
      button.addEventListener('click', () => openStripePage(button, '/billing/checkout/', statusLine))
    }
    button.type = 'button'
  }

  const row = el('div', 'flex items-center justify-between gap-4',
    el('div', '',
      el('h2', 'text-lg font-semibold text-white mb-1', 'Subscription'),
      summary))
  if (button) row.append(button)

  return el('div', CARD_CLASS, row, statusLine)
}

// The card, filled in once the billing state has loaded.
export function mountBillingCard() {
  const slot = el('div')
  apiFetch('/billing/').then(({ response, data }) => {
    if (!response.ok) return
    slot.replaceWith(createBillingCard(data))
  })
  return slot
}
