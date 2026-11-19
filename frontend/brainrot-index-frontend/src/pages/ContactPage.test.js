import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { mountContactPage } from './ContactPage.js'

const authState = vi.hoisted(() => ({ email: '' }))
vi.mock('../lib/auth.js', () => ({ getState: () => authState }))

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  authState.email = ''
})

function fillAndSend({ name = '', email, subject, message }) {
  fireEvent.input(screen.getByLabelText('Name (optional)'), { target: { value: name } })
  fireEvent.input(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.input(screen.getByLabelText('Subject'), { target: { value: subject } })
  fireEvent.input(screen.getByLabelText('Message'), { target: { value: message } })
  fireEvent.submit(screen.getByText('Send').closest('form'))
}

describe('ContactPage', () => {
  it('sends the name, email, subject and message and confirms in place', async () => {
    document.cookie = 'csrftoken=test-csrf'
    const fetchMock = vi.fn(async () => new Response('{"id": 1}', { status: 201, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    renderElement(mountContactPage().el)

    fillAndSend({ name: 'Sam', email: 'sam@example.com', subject: 'Press', message: 'Can we talk?' })

    expect(await screen.findByText("Thanks, sent. We'll reply to the email address you gave.")).toBeInTheDocument()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/contact/')
    expect(JSON.parse(options.body)).toEqual({ name: 'Sam', email: 'sam@example.com', subject: 'Press', message: 'Can we talk?' })
    expect(screen.getByLabelText('Message').value).toBe('')
  })

  it("starts with a signed-in sender's address", () => {
    authState.email = 'reader@example.com'
    renderElement(mountContactPage().el)
    expect(screen.getByLabelText('Email').value).toBe('reader@example.com')
  })

  it('says why a message was not sent', async () => {
    document.cookie = 'csrftoken=test-csrf'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"email": ["Enter a valid email address."]}', { status: 400, headers: { 'Content-Type': 'application/json' } })))
    renderElement(mountContactPage().el)

    fillAndSend({ email: 'sam@', subject: 'Hi', message: 'Hello' })

    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
  })
})
