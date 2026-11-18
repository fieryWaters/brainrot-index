import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { _resetForTesting, loginWithPassword } from '../lib/auth.js'
import { mountFamilyPage } from './FamilyPage.js'
import { mountJoinFamilyPage, pendingFamilyInviteCode } from './JoinFamilyPage.js'
import { ROLE_DESCRIPTIONS } from '../lib/roles.js'

const FAMILY = {
  members: [
    { user_id: 1, email: 'parent@example.com', role: 'admin', is_you: true },
    { user_id: 2, email: 'kid@example.com', role: 'child', is_you: false },
  ],
  invites: [],
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let requests
let familyAnswer

beforeEach(() => {
  requests = []
  familyAnswer = { role: 'admin', family: FAMILY }
  document.cookie = 'csrftoken=test-csrf'
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = String(url)
    requests.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null })
    if (path.endsWith('/auth/login/')) return jsonResponse({ email: 'kid@example.com', email_verified: true })
    if (path.endsWith('/family/') && options.method === 'GET') return jsonResponse(familyAnswer)
    if (path.endsWith('/family/members/1/')) {
      return jsonResponse({ error: 'A family needs at least one admin. Make someone else an admin first.' }, 400)
    }
    if (path.endsWith('/family/invites/')) {
      const inviteCount = requests.filter((request) => request.path.endsWith('/family/invites/')).length
      const code = inviteCount === 1 ? 'ABCDE23456' : 'FGHJK78923'
      return jsonResponse({ id: 4 + inviteCount, code, role: 'child', expires_at: '2026-11-23T00:00:00Z' }, 201)
    }
    if (path.endsWith('/family/invites/preview/')) {
      return jsonResponse({ role: 'child', invited_by: 'parent@example.com', already_in_a_family: false })
    }
    if (path.endsWith('/family/members/2/settings/')) return jsonResponse({ enabled: true, mode: 'child', allow_reveal: false })
    if (path.endsWith('/family/members/2/plugins/')) return jsonResponse({ plugins: [], enabled_limit: 8, can_change: true })
    if (path.endsWith('/store/plugins/')) {
      return jsonResponse({ plugins: [
        { slug: 'doom-framing', name: 'Doom Framing', suggested_for_children: false },
        { slug: 'money-hype', name: 'Money Hype', suggested_for_children: true },
      ] })
    }
    return jsonResponse({})
  }))
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  sessionStorage.clear()
  _resetForTesting()
  window.history.replaceState({}, '', '/')
})

describe('FamilyPage', () => {
  it('offers invites and an invite code at once when there is no family yet', async () => {
    familyAnswer = { role: 'admin', family: null }
    renderElement(mountFamilyPage().el)
    expect(await screen.findByRole('button', { name: 'Create invite' })).toBeInTheDocument()
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument()
    expect(screen.getByText(ROLE_DESCRIPTIONS.adult)).toBeInTheDocument()
  })

  it('shows the server reason and keeps the role when the last admin steps down', async () => {
    renderElement(mountFamilyPage().el)
    const roleSelect = await screen.findByLabelText('Role of parent@example.com')
    fireEvent.change(roleSelect, { target: { value: 'adult' } })
    expect(await screen.findByText('A family needs at least one admin. Make someone else an admin first.')).toBeInTheDocument()
    expect(roleSelect.value).toBe('admin')
  })

  it('creates an invite and shows its link once', async () => {
    renderElement(mountFamilyPage().el)
    fireEvent.click(await screen.findByText('Create invite'))
    expect(await screen.findByDisplayValue(`${window.location.origin}/family/join?code=ABCDE23456`)).toBeInTheDocument()
    expect(requests).toContainEqual({ path: '/api/family/invites/', method: 'POST', body: { role: 'child' } })

    fireEvent.click(screen.getByText('Create invite'))
    expect(await screen.findByDisplayValue(`${window.location.origin}/family/join?code=FGHJK78923`)).toBeInTheDocument()
  })

  it("opens a member's settings and plugins for an admin", async () => {
    renderElement(mountFamilyPage().el)
    fireEvent.click(await screen.findByText('Edit settings'))
    expect(await screen.findByText('Plugins for kid@example.com')).toBeInTheDocument()
    expect(await screen.findByText('Suggested for children: Money Hype.')).toBeInTheDocument()
    expect(screen.getByLabelText('Plugin to add').value).toBe('money-hype')
    await waitFor(() => expect(requests.some((request) => request.path === '/api/family/members/2/settings/')).toBe(true))
  })

  it('shows a child the members without controls', async () => {
    familyAnswer = { role: 'child', family: { ...FAMILY, invites: undefined } }
    renderElement(mountFamilyPage().el)
    expect(await screen.findByText('To leave this family, ask an admin to remove you.')).toBeInTheDocument()
    expect(screen.queryByText('Create invite')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Role of kid@example.com')).not.toBeInTheDocument()
  })
})

describe('JoinFamilyPage', () => {
  it('keeps the code and asks a signed-out reader to sign in', () => {
    window.history.replaceState({}, '', '/family/join?code=ABCDE23456')
    renderElement(mountJoinFamilyPage().el)
    expect(screen.getByText('Sign in')).toBeInTheDocument()
    expect(pendingFamilyInviteCode()).toBe('ABCDE23456')
  })

  it('shows who invited them and the role, then joins', async () => {
    await loginWithPassword('kid@example.com', 'password')
    window.history.replaceState({}, '', '/family/join?code=ABCDE23456')
    renderElement(mountJoinFamilyPage().el)
    expect(await screen.findByText('parent@example.com invited you to their family')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Join as Child'))
    await waitFor(() => expect(requests).toContainEqual({ path: '/api/family/join/', method: 'POST', body: { code: 'ABCDE23456' } }))
  })
})
