import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { mountThumbsPage } from './ThumbsPage.js'

function thumb(id, verdict, shouldBe, plugin, sender) {
  return {
    id,
    received_at: '2026-11-18T10:00:00+00:00',
    sender,
    verdict,
    shown_action: 'hide',
    should_be: shouldBe,
    plugin,
    severity: '',
    details: '',
    post: { platform: 'x', post_id: '185', kind: 'post', url: 'https://x.com/someone/status/185', text: `post of ${id}` },
    filters: [{
      plugin: 'shouting', version: 1, threshold: 50, flagged_action: 'hide', classification_id: 3, status: 'done',
      score: 60, label: 'caps', flagged: true,
    }],
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('ThumbsPage', () => {
  it('lists every thumbs as one row with the counts for each filter', async () => {
    const reader = { email: 'reader@example.com', signed_in: true, name: '' }
    const deleted = { email: '', signed_in: false, name: '' }
    const fetchMock = vi.fn(async () => jsonResponse({
      thumbs: [thumb('judgment-2', 'wrong', 'shown', '', reader), thumb('judgment-1', 'right', 'blocked', 'shouting', deleted)],
    }))
    vi.stubGlobal('fetch', fetchMock)
    renderElement(mountThumbsPage().el)

    expect(await screen.findByText('2 thumbs. Blocked as shouting: 1 up, 0 down; Shown: 0 up, 1 down')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/inbox/thumbs/')
    expect(screen.getByText('judgment-2').getAttribute('href')).toBe('/inbox/judgment-2')
    expect(screen.getByText('post of judgment-1')).toBeInTheDocument()
    expect(screen.getAllByText('shouting v1 60/50 hide')).toHaveLength(2)
    expect(screen.getByText('Deleted account')).toBeInTheDocument()
  })

  it('shows Blocked as Other for a thumbs that no filter covers', async () => {
    const reader = { email: 'reader@example.com', signed_in: true, name: '' }
    const missed = thumb('judgment-3', 'wrong', 'blocked', '', reader)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ thumbs: [missed] })))
    renderElement(mountThumbsPage().el)

    expect(await screen.findByText('Blocked as Other')).toBeInTheDocument()
  })

  it('tells everyone but the owner that the thumbs are not for them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ detail: 'You do not have permission.' }, 403)))
    renderElement(mountThumbsPage().el)

    expect(await screen.findByText('The inbox is only for the site owner, signed in with Google.')).toBeInTheDocument()
  })
})
