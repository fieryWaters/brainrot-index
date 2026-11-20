import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { mountInboxPage } from './InboxPage.js'

const JUDGMENT = {
  id: 'judgment-7',
  kind: 'judgment',
  received_at: '2026-11-18T10:00:00+00:00',
  sender: { email: 'reader@example.com', signed_in: true, name: '' },
  verdict: 'wrong',
  shown_action: 'hide',
  plugin: 'shouting',
  severity: 'high',
  details: 'This is fine, just loud.',
  extension_commit: 'ext2',
  post: {
    platform: 'x', post_id: '185', kind: 'post', url: 'https://x.com/someone/status/185', author: 'someone',
    community: '', text: 'STOP SCROLLING', parent_text: null,
    images: [{ source_url: 'https://pbs.twimg.com/media/a.jpg', status: 'downloaded', file_path: '/app/media/a.jpg' }],
    video: null, transcript: null,
  },
  filters: [{
    plugin: 'shouting', version: 1, threshold: 50, flagged_action: 'hide', classification_id: 3, status: 'done',
    score: 60, label: 'caps', flagged: true, reasoning: 'Written in capitals.', model: 'test-model',
    criteria: [
      { name: 'caps', question: 'Is it written in capitals?', points: 60, met: true },
      { name: 'insult', question: 'Does it insult someone?', points: 40, met: false },
    ],
  }],
  resolved: false,
  resolved_commit: '',
  resolved_note: '',
}

const CONTACT = {
  id: 'feedback-4',
  kind: 'feedback',
  received_at: '2026-11-17T10:00:00+00:00',
  sender: { email: 'sam@example.com', signed_in: false, name: 'Sam' },
  source: 'contact',
  rating: '',
  subject: 'Press question',
  text: 'Can we talk?',
  page_url: '',
  reply_email: 'sam@example.com',
  platform: '',
  post_id: '',
  shown_action: '',
  expected_action: '',
  site_commit: 'abc1234',
  extension_commit: '',
  post: null,
  filters: [],
  resolved: false,
  resolved_commit: '',
  resolved_note: '',
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('InboxPage', () => {
  it('lists open items with the post and every filter decision', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [JUDGMENT, CONTACT] }))
    vi.stubGlobal('fetch', fetchMock)
    renderElement(mountInboxPage().el)

    expect(await screen.findByText('Thumbs down on a post')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/inbox/?status=open')
    expect(screen.getByText('STOP SCROLLING')).toBeInTheDocument()
    expect(screen.getByText('60 / 50')).toBeInTheDocument()
    expect(screen.getByText(/Met: caps\./)).toBeInTheDocument()
    expect(screen.getByText('Contact: Press question')).toBeInTheDocument()
    expect(screen.getByText('Sam <sam@example.com> (not signed in)')).toBeInTheDocument()
    expect(screen.getByText('Contact: Press question').getAttribute('href')).toBe('/inbox/feedback-4')
  })

  it('marks an item resolved with the commit and note and drops it from the open list', async () => {
    document.cookie = 'csrftoken=test-csrf'
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/resolve/')) {
        return jsonResponse({ ...CONTACT, resolved: true, resolved_commit: 'def5678', resolved_note: 'Replied' })
      }
      return jsonResponse({ items: [CONTACT] })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderElement(mountInboxPage().el)

    await screen.findByText('Contact: Press question')
    fireEvent.input(screen.getByLabelText('Fixing commit'), { target: { value: 'def5678' } })
    fireEvent.input(screen.getByLabelText('Resolution note'), { target: { value: 'Replied' } })
    fireEvent.submit(screen.getByText('Mark resolved').closest('form'))

    await waitFor(() => expect(screen.queryByText('Contact: Press question')).not.toBeInTheDocument())
    const [url, options] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/inbox/feedback-4/resolve/')
    expect(JSON.parse(options.body)).toEqual({ commit: 'def5678', note: 'Replied' })
  })

  it('marks an item resolved without a commit or a note', async () => {
    document.cookie = 'csrftoken=test-csrf'
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/resolve/')) {
        return jsonResponse({ ...CONTACT, resolved: true })
      }
      return jsonResponse({ items: [CONTACT] })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderElement(mountInboxPage().el)

    await screen.findByText('Contact: Press question')
    fireEvent.submit(screen.getByText('Mark resolved').closest('form'))

    await waitFor(() => expect(screen.queryByText('Contact: Press question')).not.toBeInTheDocument())
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ commit: '', note: '' })
  })

  it('names a thumbs from a deleted account as such', async () => {
    const fromDeletedAccount = { ...JUDGMENT, sender: { email: '', signed_in: false, name: '' } }
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [fromDeletedAccount] })))
    renderElement(mountInboxPage().el)

    expect(await screen.findByText('Deleted account')).toBeInTheDocument()
    expect(screen.getByText('Post thumbs').getAttribute('href')).toBe('/inbox/thumbs')
  })

  it('opens one item by its id, as the emailed link does', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ...CONTACT, resolved: true, resolved_commit: '', resolved_note: 'Replied' }))
    vi.stubGlobal('fetch', fetchMock)
    renderElement(mountInboxPage({ itemId: 'feedback-4' }).el)

    expect(await screen.findByText('Resolved: Replied')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/inbox/feedback-4/')
  })

  it('tells everyone but the owner that the inbox is not for them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'You do not have permission.' }, 403)))
    renderElement(mountInboxPage().el)

    expect(await screen.findByText('The inbox is only for the site owner, signed in with Google.')).toBeInTheDocument()
  })
})
