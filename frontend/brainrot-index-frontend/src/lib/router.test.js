import { describe, it, expect, beforeEach, vi } from 'vitest'
import { register, navigate, resolve, setOutlet, setAuthGuard, _resetRoutesForTesting } from './router.js'

// The router is a singleton module. Each test points it at a fresh outlet and
// registers a catch-all route so resolve() always renders something.

describe('router scroll behavior', () => {
  let scrollSpy

  beforeEach(() => {
    const outlet = document.createElement('div')
    setOutlet(outlet)
    register('/:page', (params) => {
      const el = document.createElement('div')
      el.textContent = params.page
      return { el }
    })
    history.pushState({}, '', '/start')
    // jsdom doesn't implement scrollTo - spy on it so we can assert calls.
    // mockClear so a re-used spy doesn't carry calls from a prior test.
    scrollSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    scrollSpy.mockClear()
  })

  it('scrolls to top on programmatic navigation', () => {
    navigate('/gallery-detail')
    expect(scrollSpy).toHaveBeenCalledWith(0, 0)
  })

  it('does not reset scroll on resolve() alone (back/forward via popstate)', () => {
    // popstate handlers call resolve() directly, never navigate(), so the
    // browser's own scroll restoration is preserved.
    resolve()
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})

describe('router auth guard', () => {
  let outlet

  beforeEach(() => {
    _resetRoutesForTesting()
    outlet = document.createElement('div')
    document.body.appendChild(outlet)
    setOutlet(outlet)
    register('/', () => {
      const el = document.createElement('div')
      el.textContent = 'home'
      return { el }
    })
    register('/vault', () => {
      const el = document.createElement('div')
      el.textContent = 'secret'
      return { el }
    }, { requiresAuth: true })
    // jsdom doesn't implement scrollTo - navigate() calls it, so stub it.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  })

  it('redirects a guarded route to / when the guard denies access', () => {
    window.history.replaceState({}, '', '/vault')
    setAuthGuard(() => false)

    resolve()

    expect(window.location.pathname).toBe('/')
    expect(outlet.textContent).toContain('home')
    expect(outlet.textContent).not.toContain('secret')
  })

  it('renders the guarded route when the guard allows access', () => {
    window.history.replaceState({}, '', '/vault')
    setAuthGuard(() => true)

    resolve()

    expect(window.location.pathname).toBe('/vault')
    expect(outlet.textContent).toContain('secret')
  })

  it('does not redirect public routes even when the guard denies', () => {
    window.history.replaceState({}, '', '/')
    setAuthGuard(() => false)

    resolve()

    expect(window.location.pathname).toBe('/')
    expect(outlet.textContent).toContain('home')
  })

  it('replaces (not pushes) history so the blocked page is not on Back', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState')
    window.history.replaceState({}, '', '/vault')
    setAuthGuard(() => false)

    resolve()

    expect(pushSpy).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe('/')
  })
})
