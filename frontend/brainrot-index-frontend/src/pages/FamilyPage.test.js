import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'
import { _resetForTesting, loginWithPassword } from '../lib/auth.js'
import { mountFamilyPage } from './FamilyPage.js'
import { mountJoinFamilyPage, pendingFamilyInviteCode } from './JoinFamilyPage.js'

const FAMILY = {
  name: 'The Smiths',
  members: [
    { user_id: 1, email: 'parent@example.com', role: 'superadmin', is_you: true },
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
  familyAnswer = { role: 'superadmin', family: FAMILY }
  document.cookie = 'csrftoken=test-csrf'
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const path = String(url)
    requests.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : null })
    if (path.endsWith('/auth/login/')) return jsonResponse({ email: 'kid@example.com', email_verified: true })
    if (path.endsWith('/family/') && options.method === 'GET') return jsonResponse(familyAnswer)
    if (path.endsWith('/family/members/1/')) {
      return jsonResponse({ error: 'A family needs at least one superadmin. Make someone else a superadmin first.' }, 400)
    }
    if (path.endsWith('/family/invites/')) return jsonResponse({ id: 5, code: 'ABCDE23456', role: 'child', expires_at: '2026-11-23T00:00:00Z' }, 201)
    if (path.endsWith('/family/invites/preview/')) {
      return jsonResponse({ family_name: 'The Smiths', role: 'child', invited_by: 'parent@example.com', already_in_a_family: false })
    }
    if (path.endsWith('/family/members/2/settings/')) return jsonResponse({ enabled: true, mode: 'child', allow_reveal: false })
    if (path.endsWith('/family/members/2/plugins/')) return jsonResponse({ plugins: [], enabled_limit: 8, can_change: true })
    if (path.endsWith('/store/plugins/')) return jsonResponse({ plugins: [] })
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
  it('offers to start a family or enter a code when there is none', async () => {
    familyAnswer = { role: 'superadmin', family: null }
    renderElement(mountFamilyPage().el)
    expect(await screen.findByText('Start a family')).toBeInTheDocument()
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument()
  })

  it('shows the server reason and keeps the role when the last superadmin steps down', async () => {
    renderElement(mountFamilyPage().el)
    const roleSelect = await screen.findByLabelText('Role of parent@example.com')
    fireEvent.change(roleSelect, { target: { value: 'admin' } })
    expect(await screen.findByText('A family needs at least one superadmin. Make someone else a superadmin first.')).toBeInTheDocument()
    expect(roleSelect.value).toBe('superadmin')
  })

  it('creates an invite and shows its link once', async () => {
    renderElement(mountFamilyPage().el)
    fireEvent.click(await screen.findByText('Create invite'))
    expect(await screen.findByDisplayValue(`${window.location.origin}/family/join?code=ABCDE23456`)).toBeInTheDocument()
    expect(requests).toContainEqual({ path: '/api/family/invites/', method: 'POST', body: { role: 'child' } })
  })

  it("opens a member's settings and plugins for a superadmin", async () => {
    renderElement(mountFamilyPage().el)
    fireEvent.click(await screen.findByText('Edit settings'))
    expect(await screen.findByText('Plugins for kid@example.com')).toBeInTheDocument()
    await waitFor(() => expect(requests.some((request) => request.path === '/api/family/members/2/settings/')).toBe(true))
  })

  it('shows a child the members without controls', async () => {
    familyAnswer = { role: 'child', family: { ...FAMILY, invites: undefined } }
    renderElement(mountFamilyPage().el)
    expect(await screen.findByText('To leave this family, ask a superadmin to remove you.')).toBeInTheDocument()
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

  it('shows the family and role, then joins', async () => {
    await loginWithPassword('kid@example.com', 'password')
    window.history.replaceState({}, '', '/family/join?code=ABCDE23456')
    renderElement(mountJoinFamilyPage().el)
    expect(await screen.findByText('The Smiths')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Join as Child'))
    await waitFor(() => expect(requests).toContainEqual({ path: '/api/family/join/', method: 'POST', body: { code: 'ABCDE23456' } }))
  })
})
