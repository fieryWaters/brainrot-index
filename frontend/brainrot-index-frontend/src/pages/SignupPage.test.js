import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { _resetForTesting } from '../lib/auth.js'
import { mountSignupPage } from './SignupPage.js'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let requests

beforeEach(() => {
  _resetForTesting()
  requests = []
  document.cookie = 'csrftoken=test-csrf'
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    requests.push({ path: String(url), body: options.body ? JSON.parse(options.body) : null })
    return jsonResponse(
      { error: 'Creating an account needs an invite code.', code: 'invite_required' }, 400)
  }))
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('SignupPage', () => {
  it('sends the invite code and shows why sign-up was refused', async () => {
    renderElement(mountSignupPage().el)
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
