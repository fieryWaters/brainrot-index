import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { createFeedbackButton } from './FeedbackButton.js'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

function openPanel() {
  fireEvent.click(screen.getByText('Feedback', { selector: 'button' }))
}

describe('FeedbackButton', () => {
  it('sends a thumbs down with the note and the page address, and confirms in place', async () => {
    document.cookie = 'csrftoken=test-csrf'
    const fetchMock = vi.fn(async () => new Response('{"id": 1}', { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    renderElement(createFeedbackButton().el)

    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Thumbs down' }))
    expect(screen.getByRole('button', { name: 'Thumbs down' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.input(screen.getByLabelText('Feedback note'), { target: { value: 'Slider is confusing' } })
    fireEvent.click(screen.getByText('Send'))

    expect(await screen.findByText('Thanks, sent.')).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback/')
    expect(JSON.parse(options.body)).toEqual({
      source: 'site', rating: 'down', text: 'Slider is confusing', page_url: window.location.href,
    })
    await waitFor(() => expect(screen.getByLabelText('Feedback note').value).toBe(''))
  })

  it('sends a thumbs up without any text', async () => {
    document.cookie = 'csrftoken=test-csrf'
    const fetchMock = vi.fn(async () => new Response('{"id": 1}', { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    renderElement(createFeedbackButton().el)

    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))
    fireEvent.click(screen.getByText('Send'))

    expect(await screen.findByText('Thanks, sent.')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      source: 'site', rating: 'up', text: '', page_url: window.location.href,
    })
  })
})

describe('FeedbackButton failures', () => {
  it('says why a report was not sent', async () => {
    document.cookie = 'csrftoken=test-csrf'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429, headers: { 'Content-Type': 'application/json' } })))
    renderElement(createFeedbackButton().el)

    openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Thumbs up' }))
    fireEvent.click(screen.getByText('Send'))

    expect(await screen.findByText('Not sent: too many reports from this address. Please try again in an hour.')).toBeInTheDocument()
  })
})
