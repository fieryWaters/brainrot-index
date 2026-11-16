import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { createFeedbackButton } from './FeedbackButton.js'

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('FeedbackButton', () => {
  it('sends the note with the page address and confirms in place', async () => {
    document.cookie = 'csrftoken=test-csrf'
    const fetchMock = vi.fn(async () => new Response('{"id": 1}', { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    renderElement(createFeedbackButton().el)

    fireEvent.click(screen.getByText('Feedback'))
    fireEvent.input(screen.getByPlaceholderText('What went wrong, or what should change?'), { target: { value: 'Slider is confusing' } })
    fireEvent.click(screen.getByText('Send'))

    expect(await screen.findByText('Thanks, sent.')).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback/')
    expect(JSON.parse(options.body)).toEqual({ source: 'site', text: 'Slider is confusing', page_url: window.location.href })
    await waitFor(() => expect(screen.getByPlaceholderText('What went wrong, or what should change?').value).toBe(''))
  })
})
