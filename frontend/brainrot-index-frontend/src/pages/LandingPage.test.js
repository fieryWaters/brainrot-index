import { describe, it, expect, afterEach } from 'vitest'
import { screen } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { mountLandingPage } from './LandingPage.js'
import { mountPrivacyPage } from './PrivacyPage.js'
import { mountTermsPage } from './TermsPage.js'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('LandingPage', () => {
  it('shows the tagline on two lines that do not break', () => {
    renderElement(mountLandingPage().el)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('The algorithmthat works for you')
    expect(heading.querySelectorAll('.whitespace-nowrap')).toHaveLength(2)
  })

  it('sends a visitor to sign up', () => {
    renderElement(mountLandingPage().el)
    const startLinks = screen.getAllByText('Start your free 7-day trial')
    expect(startLinks.length).toBeGreaterThan(0)
    startLinks.forEach((startLink) => expect(startLink.getAttribute('href')).toBe('/signup'))
  })
})

describe('Legal pages', () => {
  it('state what is stored and give the contact address', () => {
    renderElement(mountPrivacyPage().el)
    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument()
    expect(screen.getAllByText(/the extension\s+sends us the posts you see on supported sites/).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Who we share it with' })).toBeInTheDocument()
    expect(screen.getByText('For questions and requests, use the Feedback button on any page.')).toBeInTheDocument()
  })

  it('state the price and how to cancel', () => {
    renderElement(mountTermsPage().el)
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument()
    expect(screen.getByText(/costs \$5 per month/)).toBeInTheDocument()
  })
})
