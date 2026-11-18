import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { _resetForTesting, loginWithPassword } from '../lib/auth.js'
import { createLayout } from './Layout.js'
import { renderElement } from '../test-utils.js'

beforeEach(() => {
  _resetForTesting()
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Layout', () => {
  it('renders navigation with brand name', () => {
    const layout = createLayout()
    renderElement(layout.el)
    expect(screen.getAllByText('BrainRot Index').length).toBeGreaterThanOrEqual(1)
  })

  it('renders a lean signed-out nav: one Sign in button, no Home or Sign up', () => {
    const layout = createLayout()
    renderElement(layout.el)
    expect(screen.getByText('Sign in')).toBeInTheDocument()
    // The logo is the home link; a separate Home entry and a second auth
    // button just crowd the nav on phones.
    expect(screen.queryByText('Home')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign up')).not.toBeInTheDocument()
  })

  it('renders footer', () => {
    const layout = createLayout()
    renderElement(layout.el)
    const elements = screen.getAllByText('BrainRot Index')
    expect(elements.length).toBeGreaterThanOrEqual(2)
  })

  it('exposes getOutlet() returning the page outlet element', () => {
    const layout = createLayout()
    renderElement(layout.el)
    const outlet = layout.getOutlet()
    expect(outlet).not.toBeNull()
    expect(outlet.id).toBe('page-outlet')
  })

  it('returns the user home after signing out', async () => {
    // csrf + login + logout endpoints. /auth/me/ isn't called here because the
    // login response applies the session synchronously.
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const requestUrl = String(url)
      if (requestUrl.includes('/auth/csrf/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (requestUrl.includes('/auth/login/')) {
        return new Response(JSON.stringify({
          email: 'artist@example.com',
          email_verified: true,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (requestUrl.includes('/auth/logout/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } })
    }))
    await loginWithPassword('artist@example.com', 'password')

    // Start somewhere that should be unreachable once signed out.
    window.history.replaceState({}, '', '/account')
    const layout = createLayout()
    renderElement(layout.el)

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))

    await waitFor(() => expect(window.location.pathname).toBe('/'))
  })
})
