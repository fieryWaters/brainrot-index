import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { _resetForTesting } from '../lib/auth.js'
import { mountSignupPage } from './SignupPage.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let requests

function serveSignupRequiringInvite(signupRequiresInvite) {
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = String(url)
    requests.push({ path, body: options.body ? JSON.parse(options.body) : null })
    if (path.endsWith('/auth/csrf/')) return jsonResponse({ status: 'ok', signup_requires_invite: signupRequiresInvite })
    return jsonResponse({ error: 'Creating an account needs an invite code.', code: 'invite_required' }, 400)
  }))
}

beforeEach(() => {
  _resetForTesting()
  requests = []
  document.cookie = 'csrftoken=test-csrf'
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function inviteField() {
  return screen.getByPlaceholderText('Invite code').closest('div.flex')
}

describe('SignupPage', () => {
  it('hides the invite code field when the server needs none', async () => {
    serveSignupRequiringInvite(false)
    renderElement(mountSignupPage().el)
    await waitFor(() => expect(requests.some((request) => request.path.endsWith('/auth/csrf/'))).toBe(true))
    expect(inviteField()).toHaveClass('hidden')
  })

  it('shows the invite code field, sends it, and shows why sign-up was refused', async () => {
    serveSignupRequiringInvite(true)
    renderElement(mountSignupPage().el)
    await waitFor(() => expect(inviteField()).not.toHaveClass('hidden'))

    fireEvent.input(screen.getByPlaceholderText('Invite code'), { target: { value: ' abcd-efgh-jkmn ' } })
    fireEvent.input(screen.getByPlaceholderText('you@example.com'), { target: { value: 'new@example.com' } })
    fireEvent.input(screen.getByPlaceholderText('Password'), { target: { value: 'correct-horse-9-battery' } })
    fireEvent.submit(screen.getByText('Create account', { selector: 'button' }).closest('form'))

    expect(await screen.findByText('Creating an account needs an invite code.')).toBeInTheDocument()
    expect(requests.find((request) => request.path.endsWith('/auth/signup/')).body).toEqual({
      email: 'new@example.com', password: 'correct-horse-9-battery', invite_code: 'abcd-efgh-jkmn',
    })
  })
})
