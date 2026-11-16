import { describe, it, expect, afterEach } from 'vitest'
import { screen } from '@testing-library/dom'
import { createErrorBanner } from './ErrorBanner.js'
import { renderElement } from '../test-utils.js'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ErrorBanner', () => {
  it('renders nothing visible when message is empty', () => {
    const el = createErrorBanner('')
    renderElement(el)
    expect(el.className).toContain('hidden')
  })

  it('renders nothing visible when message is falsy', () => {
    const el = createErrorBanner(null)
    renderElement(el)
    expect(el.className).toContain('hidden')
  })

  it('renders error message with error styling by default', () => {
    const el = createErrorBanner('Something went wrong')
    renderElement(el)
    const banner = screen.getByText('Something went wrong')
    expect(banner).toBeInTheDocument()
    expect(banner.className).toContain('bg-red-500/10')
  })

  it('renders warning variant with amber styling', () => {
    const el = createErrorBanner('Watch out', 'warning')
    renderElement(el)
    const banner = screen.getByText('Watch out')
    expect(banner.className).toContain('bg-amber-500/10')
  })
})
