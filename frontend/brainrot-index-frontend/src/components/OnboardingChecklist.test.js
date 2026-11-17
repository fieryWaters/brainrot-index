import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { createOnboardingChecklist } from './OnboardingChecklist.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function serveOnboarding(status) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).endsWith('/onboarding/')) return jsonResponse(status)
    return jsonResponse({})
  }))
}

function stepDone(title) {
  return screen.getByText(title).closest('li').dataset.done === 'true'
}

beforeEach(() => {
  document.cookie = 'csrftoken=test-csrf'
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('OnboardingChecklist', () => {
  it('shows each step done or not from the server', async () => {
    serveOnboarding({ email_verified: true, extension_connected: false, feed_opened: false })
    renderElement(createOnboardingChecklist().el)

    expect(await screen.findByText('1 of 4 done')).toBeInTheDocument()
    expect(stepDone('Verify your email')).toBe(true)
    expect(stepDone('Install the extension')).toBe(false)
    expect(stepDone('Connect the extension')).toBe(false)
    expect(stepDone('Open your feed')).toBe(false)
    expect(screen.getByText('Show me how').getAttribute('href')).toBe('/install')
  })

  it('counts the extension as installed once it answers on the page', async () => {
    serveOnboarding({ email_verified: true, extension_connected: false, feed_opened: false })
    const checklist = createOnboardingChecklist()
    renderElement(checklist.el)
    await screen.findByText('1 of 4 done')

    checklist.markExtensionInstalled()

    expect(screen.getByText('2 of 4 done')).toBeInTheDocument()
    expect(stepDone('Install the extension')).toBe(true)
  })

  it('offers to resend the verification email while the email is unverified', async () => {
    serveOnboarding({ email_verified: false, extension_connected: false, feed_opened: false })
    renderElement(createOnboardingChecklist().el)

    fireEvent.click(await screen.findByText('Resend the email'))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/auth/resend-verification/', expect.objectContaining({ method: 'POST' })))
  })

  it('collapses to one line once every step is done, and can be opened again', async () => {
    serveOnboarding({ email_verified: true, extension_connected: true, feed_opened: true })
    renderElement(createOnboardingChecklist().el)

    expect(await screen.findByText('You are set up. Your feeds are being filtered.')).toBeInTheDocument()
    expect(screen.queryByText('Verify your email')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Show setup steps'))
    expect(screen.getByText('4 of 4 done')).toBeInTheDocument()
  })
})
