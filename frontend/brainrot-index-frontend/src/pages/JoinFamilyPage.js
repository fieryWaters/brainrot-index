// Accepting a family invite from its link (/family/join?code=...). Someone
// signed out is asked to sign in first; the code is kept for this browser
// tab so the dashboard can bring them back to it.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { getState } from '../lib/auth.js'
import { el } from '../lib/dom.js'
import { navigate } from '../lib/router.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { CARD_CLASS, PRIMARY_BUTTON_CLASS, AMBER_BUTTON_CLASS } from '../components/styles.js'
import { ROLE_DESCRIPTIONS, ROLE_NAMES } from '../lib/roles.js'

const PENDING_INVITE_KEY = 'brainrot-index-family-invite'

export function pendingFamilyInviteCode() {
  try {
    return sessionStorage.getItem(PENDING_INVITE_KEY) || ''
  } catch {
    return ''
  }
}

function rememberInviteCode(code) {
  try {
    if (code) {
      sessionStorage.setItem(PENDING_INVITE_KEY, code)
    } else {
      sessionStorage.removeItem(PENDING_INVITE_KEY)
    }
  } catch {
    // Without storage the reader opens the invite link again after signing in.
  }
}

export function mountJoinFamilyPage() {
  const code = new URLSearchParams(window.location.search).get('code') || ''
  const card = el('div', CARD_CLASS, el('p', 'text-sm text-white/50', 'Loading...'))
  const container = el('div', 'max-w-md mx-auto px-4 py-12',
    el('h1', 'text-3xl font-bold mb-8 text-white', 'Join a family'),
    card)

  function showMessage(message, ...actions) {
    card.replaceChildren(
      el('p', 'text-sm text-white/70', message),
      el('div', 'mt-4 flex flex-wrap gap-3', ...actions))
  }

  function link(text, href, className) {
    const anchor = el('a', className, text)
    anchor.href = href
    return anchor
  }

  if (!code) {
    showMessage('This invite link is missing its code. Ask for the link again, or enter the code on the family page.',
      link('Family page', '/family', AMBER_BUTTON_CLASS))
    return { el: container }
  }

  if (!getState().isAuthenticated) {
    rememberInviteCode(code)
    showMessage('Sign in or create an account to accept this invite. Your dashboard will bring you back here.',
      link('Sign in', '/login', PRIMARY_BUTTON_CLASS),
      link('Create an account', '/signup', AMBER_BUTTON_CLASS))
    return { el: container }
  }

  apiFetch('/family/invites/preview/', { method: 'POST', body: { code } }).then(({ response, data }) => {
    if (!response.ok) {
      rememberInviteCode('')
      showMessage(errorMessageFrom(data, 'Could not check this invite. Please reload the page.'),
        link('Go to the dashboard', '/dashboard', AMBER_BUTTON_CLASS))
      return
    }
    if (data.already_in_a_family) {
      showMessage(`You are already in a family. To join ${data.family_name}, leave your family first.`,
        link('Family page', '/family', AMBER_BUTTON_CLASS))
      return
    }

    let errorSlot = el('div')
    const joinButton = el('button', PRIMARY_BUTTON_CLASS, `Join as ${ROLE_NAMES[data.role]}`)
    joinButton.type = 'button'
    joinButton.addEventListener('click', async () => {
      joinButton.disabled = true
      const result = await apiFetch('/family/join/', { method: 'POST', body: { code } })
      if (!result.response.ok) {
        joinButton.disabled = false
        const next = createErrorBanner(errorMessageFrom(result.data, 'Could not join. Please try again.'))
        errorSlot.replaceWith(next)
        errorSlot = next
        return
      }
      rememberInviteCode('')
      navigate('/family')
    })

    const declineButton = el('button', AMBER_BUTTON_CLASS, 'Not now')
    declineButton.type = 'button'
    declineButton.addEventListener('click', () => {
      rememberInviteCode('')
      navigate('/dashboard')
    })

    const invitedBy = data.invited_by ? ` ${data.invited_by} invited you.` : ''
    card.replaceChildren(
      el('h2', 'text-lg font-semibold text-white mb-1', data.family_name),
      el('p', 'text-sm text-white/60 mb-4', `You are invited to join as ${ROLE_NAMES[data.role]}.${invitedBy}`),
      el('p', 'text-sm text-white/70 mb-6', ROLE_DESCRIPTIONS[data.role]),
      errorSlot,
      el('div', 'flex flex-wrap gap-3', joinButton, declineButton))
  })

  return { el: container }
}
