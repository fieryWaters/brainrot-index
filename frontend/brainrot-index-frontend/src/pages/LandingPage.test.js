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
  it('shows the feed before and after filtering', () => {
    renderElement(mountLandingPage().el)
    expect(screen.getByText('Your feed today')).toBeInTheDocument()
    expect(screen.getByText('Your feed with BrainRot Index')).toBeInTheDocument()
    expect(screen.getByText('Hidden - Engagement bait: Asks for engagement (94/100)')).toBeInTheDocument()
    expect(screen.getByText('Blurred - Ragebait: Blames a group (91/100)')).toBeInTheDocument()
  })

  it('has one pricing box and answers what data is collected', () => {
    renderElement(mountLandingPage().el)
    expect(screen.getAllByText('One plan, one price')).toHaveLength(1)
    expect(screen.getByText('What data does it collect?')).toBeInTheDocument()
    expect(screen.getByText('Read the Privacy Policy').getAttribute('href')).toBe('/privacy')
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
    expect(screen.getAllByText(/together with the account that sent them/).length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'When a person reads your posts' })).toBeInTheDocument()
    expect(screen.getAllByText('support@brainrotindex.com').length).toBeGreaterThan(0)
  })

  it('state the price and how to cancel', () => {
    renderElement(mountTermsPage().el)
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeInTheDocument()
    expect(screen.getByText(/costs \$5 per month/)).toBeInTheDocument()
  })
})
