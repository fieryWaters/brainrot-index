import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { createBillingCard, TRIAL_ENDED_TEXT } from './BillingCard.js'

const TRIAL = {
  status: 'trialing', has_access: true, comp: false, trial_days_left: 5,
  current_period_end: null, cancel_at_period_end: false, can_manage: false,
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('BillingCard', () => {
  it('shows trial days left and a subscribe button', () => {
    renderElement(createBillingCard(TRIAL))
    expect(screen.getByText('Free trial: 5 days left. Then $4.99 per month.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
  })

  it('says plainly when the trial has ended', () => {
    renderElement(createBillingCard({ ...TRIAL, status: 'trialing', has_access: false, trial_days_left: 0 }))
    expect(screen.getByText(TRIAL_ENDED_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subscribe' })).toBeInTheDocument()
  })

  it('offers the Customer Portal to a subscriber, with the end date once canceled', () => {
    renderElement(createBillingCard({
      ...TRIAL, status: 'active', trial_days_left: null, can_manage: true,
      cancel_at_period_end: true, current_period_end: '2026-12-16T00:00:00Z',
    }))
    expect(screen.getByText(/^Canceled\. Filtering keeps working until /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeInTheDocument()
  })

  it('shows no button on a comp account', () => {
    renderElement(createBillingCard({ ...TRIAL, comp: true }))
    expect(screen.getByText('Free forever on this account.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the reason when Checkout cannot open', async () => {
    document.cookie = 'csrftoken=test-csrf'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'Payments are not set up yet.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } })))
    renderElement(createBillingCard(TRIAL))
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }))
    await waitFor(() => expect(screen.getByText('Payments are not set up yet.')).toBeInTheDocument())
  })
})
