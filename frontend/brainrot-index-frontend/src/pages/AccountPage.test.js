import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { mountAccountPage } from './AccountPage.js'
import { _resetForTesting, refreshSession, getState } from '../lib/auth.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let requests

beforeEach(async () => {
  _resetForTesting()
  requests = []
  document.cookie = 'csrftoken=test-csrf'
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const path = String(url)
    requests.push({ path, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null })
    if (path.endsWith('/auth/me/')) return jsonResponse({ email: 'reader@example.com', email_verified: true, auth_provider: 'password' })
    if (path.endsWith('/account/change-password/')) return jsonResponse({ error: 'Your current password is not right.' }, 400)
    return jsonResponse({ status: 'ok' })
  }))
  await refreshSession()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('AccountPage', () => {
  it('offers the data download as a file link', () => {
    renderElement(mountAccountPage().el)
    const download = screen.getByText('Download my data')
    expect(download.getAttribute('href')).toBe('/api/account/export/')
    expect(download.hasAttribute('download')).toBe(true)
  })

  it('shows the server reason when a password change is refused', async () => {
    renderElement(mountAccountPage().el)
    fireEvent.input(screen.getByLabelText('Current password'), { target: { value: 'wrong-password' } })
    fireEvent.input(screen.getByLabelText('New password'), { target: { value: 'a-brand-new-9-password' } })
    fireEvent.click(screen.getByText('Change password'))

    expect(await screen.findByText('Your current password is not right.')).toBeInTheDocument()
    expect(requests).toContainEqual({
      path: '/api/account/change-password/',
      method: 'POST',
      body: { current_password: 'wrong-password', new_password: 'a-brand-new-9-password' },
    })
  })

  it('says what deleting removes and keeps', () => {
    renderElement(mountAccountPage().el)
    expect(screen.getByText('the reports and feedback you sent us')).toBeInTheDocument()
    expect(screen.getByText(/stay in the shared cache/)).toBeInTheDocument()
  })

  it('deletes only after the email is typed, then signs out', async () => {
    renderElement(mountAccountPage().el)
    const deleteButton = screen.getByText('Delete my account')
    expect(deleteButton).toBeDisabled()

    fireEvent.input(screen.getByLabelText('Type your email address to confirm'), { target: { value: 'reader@example' } })
    expect(deleteButton).toBeDisabled()
    fireEvent.input(screen.getByLabelText('Type your email address to confirm'), { target: { value: 'Reader@Example.com' } })
    expect(deleteButton).not.toBeDisabled()

    fireEvent.click(deleteButton)

    expect(await screen.findByText('Your account is deleted')).toBeInTheDocument()
    expect(requests).toContainEqual({ path: '/api/account/delete/', method: 'POST', body: { email: 'Reader@Example.com' } })
    await waitFor(() => expect(getState().isAuthenticated).toBe(false))
  })
})
