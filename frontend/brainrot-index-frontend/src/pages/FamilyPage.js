// Family page: what each role can do, and the members with their roles. An
// admin invites people (the first invite makes the family), changes roles,
// edits each member's settings and plugins and removes them. Someone in no
// family can also enter an invite code.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { navigate } from '../lib/router.js'
import { ROLE_DESCRIPTIONS, ROLE_NAMES } from '../lib/roles.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { createFilterSettingsCard, createInstalledPluginsCard } from '../components/FilterSettings.js'
import {
  ACCENT_BUTTON_CLASS, CARD_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS, SELECT_CLASS,
} from '../components/styles.js'

const ROLE_OPTIONS = ['admin', 'adult', 'child']

function createRoleSelect(value, label) {
  const select = el('select', SELECT_CLASS)
  for (const role of ROLE_OPTIONS) {
    const option = el('option', '', ROLE_NAMES[role])
    option.value = role
    select.appendChild(option)
  }
  select.value = value
  select.setAttribute('aria-label', label)
  return select
}

function createButton(className, text) {
  const button = el('button', className, text)
  button.type = 'button'
  return button
}

// A button that asks for a second click before doing something hard to undo.
function createConfirmButton(text, confirmText, onConfirm) {
  const button = createButton(QUIET_BUTTON_CLASS, text)
  let armed = false
  button.addEventListener('click', () => {
    if (!armed) {
      armed = true
      button.textContent = confirmText
      button.classList.add('text-red-400')
      return
    }
    button.disabled = true
    onConfirm()
  })
  return button
}

function inviteLinkFor(code) {
  return `${window.location.origin}/family/join?code=${encodeURIComponent(code)}`
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function mountFamilyPage() {
  const content = el('div', '', el('p', 'text-sm text-white/50', 'Loading...'))
  let errorSlot = el('div')
  const container = el('div', 'max-w-2xl mx-auto px-4 py-12',
    el('h1', 'text-3xl font-bold mb-8 text-white', 'Family'),
    errorSlot,
    content)

  function showError(message) {
    const next = createErrorBanner(message)
    errorSlot.replaceWith(next)
    errorSlot = next
  }

  // Sends a family change; the server answers with the family as it now is.
  async function send(endpoint, method, body, failureMessage) {
    const { response, data } = await apiFetch(endpoint, { method, body })
    if (!response.ok) {
      showError(errorMessageFrom(data, failureMessage))
      return false
    }
    showError('')
    render(data)
    return true
  }

  // -- No family yet --
  function createJoinCard() {
    const codeInput = el('input', INPUT_CLASS)
    codeInput.placeholder = 'ABCDE-23456'
    codeInput.setAttribute('aria-label', 'Invite code')
    const codeButton = createButton(ACCENT_BUTTON_CLASS + ' shrink-0', 'Continue')
    codeButton.addEventListener('click', () => {
      const code = codeInput.value.trim()
      if (!code) {
        showError('Enter the invite code you were given.')
        return
      }
      navigate(`/family/join?code=${encodeURIComponent(code)}`)
    })

    return el('div', CARD_CLASS,
      el('h2', 'text-lg font-semibold text-white mb-1', 'Have an invite code?'),
      el('p', 'text-sm text-white/60 mb-4', 'Enter the code someone in your family sent you.'),
      el('div', 'flex flex-col sm:flex-row gap-3', codeInput, codeButton))
  }

  // -- Roles --
  function createRoleList() {
    return el('dl', 'grid gap-3 sm:grid-cols-3',
      ...ROLE_OPTIONS.map((role) => el('div', 'rounded-xl border border-white/10 bg-white/5 p-3',
        el('dt', 'text-sm font-semibold text-glow-300', ROLE_NAMES[role]),
        el('dd', 'mt-1 text-xs text-white/60', ROLE_DESCRIPTIONS[role]))))
  }

  // -- Members --
  function createMemberRow(member, isAdmin) {
    const memberName = el('p', 'text-white truncate', member.email, member.is_you ? el('span', 'text-white/40', ' (you)') : '')

    if (!isAdmin) {
      return el('div', 'py-3 border-t border-white/10 first:border-t-0 flex items-center justify-between gap-4 text-sm',
        memberName,
        el('span', 'text-white/60 shrink-0', ROLE_NAMES[member.role]))
    }

    const roleSelect = createRoleSelect(member.role, `Role of ${member.email}`)
    roleSelect.addEventListener('change', async () => {
      const changed = await send(`/family/members/${member.user_id}/`, 'PATCH', { role: roleSelect.value },
        'Could not change that role. Please try again.')
      if (!changed) roleSelect.value = member.role
    })

    const editor = el('div', 'hidden mt-4')
    const actions = el('div', 'flex flex-wrap items-center gap-2', roleSelect)
    if (!member.is_you) {
      const editButton = createButton(QUIET_BUTTON_CLASS, 'Edit settings')
      editButton.setAttribute('aria-expanded', 'false')
      editButton.addEventListener('click', () => {
        const opening = editor.classList.contains('hidden')
        if (opening && editor.childElementCount === 0) {
          const basePath = `/family/members/${member.user_id}`
          editor.append(
            createFilterSettingsCard({ basePath, canChange: true }),
            createInstalledPluginsCard({
              basePath,
              title: `Plugins for ${member.email}`,
              showAddPlugin: true,
              forChild: member.role === 'child',
            }))
        }
        editor.classList.toggle('hidden')
        editButton.setAttribute('aria-expanded', String(opening))
        editButton.textContent = opening ? 'Close' : 'Edit settings'
      })
      const removeButton = createConfirmButton('Remove', 'Click again to remove', () =>
        send(`/family/members/${member.user_id}/`, 'DELETE', undefined, 'Could not remove that member. Please try again.'))
      actions.append(editButton, removeButton)
    }

    return el('div', 'py-3 border-t border-white/10 first:border-t-0 text-sm',
      el('div', 'flex flex-col sm:flex-row sm:items-center justify-between gap-2', memberName, actions),
      editor)
  }

  // -- Invites (admin) --
  // onInviteCreated runs after each invite is made; the first one makes the family.
  function createInviteCard(invites, onInviteCreated) {
    const roleSelect = createRoleSelect('child', 'Role for the invited person')

    let result = el('div')
    const inviteButton = createButton(PRIMARY_BUTTON_CLASS + ' shrink-0', 'Create invite')
    inviteButton.addEventListener('click', async () => {
      inviteButton.disabled = true
      const { response, data } = await apiFetch('/family/invites/', { method: 'POST', body: { role: roleSelect.value } })
      inviteButton.disabled = false
      if (!response.ok) {
        showError(errorMessageFrom(data, 'Could not create the invite. Please try again.'))
        return
      }
      showError('')
      const next = createInviteResult(data)
      result.replaceWith(next)
      result = next
      if (onInviteCreated) onInviteCreated()
    })

    const pending = invites.map((invite) => {
      const revokeButton = createButton(QUIET_BUTTON_CLASS, 'Revoke')
      revokeButton.addEventListener('click', () => {
        revokeButton.disabled = true
        send(`/family/invites/${invite.id}/revoke/`, 'POST', undefined, 'Could not revoke that invite. Please try again.')
      })
      return el('div', 'py-2 border-t border-white/10 flex items-center justify-between gap-4 text-sm',
        el('span', 'text-white/70', `${ROLE_NAMES[invite.role]} invite, unused, expires ${formatDate(invite.expires_at)}`),
        revokeButton)
    })

    return el('div', CARD_CLASS,
      el('h2', 'text-lg font-semibold text-white mb-1', 'Invite someone'),
      el('p', 'text-sm text-white/60 mb-4', 'Each invite works once, for 7 days. Send the link or the code to the person you are inviting.'),
      el('div', 'mb-4', createRoleList()),
      el('label', 'flex flex-col sm:flex-row sm:items-center gap-3 mb-4',
        el('span', LABEL_CLASS, 'Joins as'),
        roleSelect,
        inviteButton),
      result,
      pending.length > 0 ? el('div', 'mt-4', el('p', LABEL_CLASS + ' mb-1', 'Waiting to be accepted'), ...pending) : '')
  }

  function createInviteResult(invite) {
    const link = inviteLinkFor(invite.code)
    const linkInput = el('input', INPUT_CLASS)
    linkInput.readOnly = true
    linkInput.value = link
    linkInput.setAttribute('aria-label', 'Invite link')
    const copyButton = createButton(ACCENT_BUTTON_CLASS + ' shrink-0', 'Copy link')
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link)
        copyButton.textContent = 'Copied'
      } catch {
        linkInput.select()
        copyButton.textContent = 'Press Ctrl+C to copy'
      }
    })
    return el('div', 'rounded-xl border border-glow-400/20 bg-shield-400/10 p-4 flex flex-col gap-3',
      el('p', 'text-sm text-white/70', `${ROLE_NAMES[invite.role]} invite created. It is shown only now, so copy it before leaving this page.`),
      el('div', 'flex flex-col sm:flex-row gap-3', linkInput, copyButton),
      el('p', 'text-sm text-white/60', 'Code: ', el('span', 'font-mono text-white', invite.code)))
  }

  // -- Leaving --
  function createLeaveCard(role) {
    if (role === 'child') {
      return el('p', 'text-sm text-white/50', 'To leave this family, ask an admin to remove you.')
    }
    const leaveButton = createConfirmButton('Leave family', 'Click again to leave', () =>
      send('/family/leave/', 'POST', undefined, 'Could not leave the family. Please try again.'))
    return el('div', 'flex items-center justify-between gap-4 text-sm',
      el('p', 'text-white/50', 'Your own settings and plugins stay as they are.'),
      leaveButton)
  }

  // Someone in no family is their own admin: their first invite makes the
  // family, and from then on they cannot join another, so the code box goes.
  function render(data) {
    if (data.family === null) {
      const joinCard = createJoinCard()
      content.replaceChildren(createInviteCard([], () => joinCard.remove()), joinCard)
      return
    }

    const isAdmin = data.role === 'admin'
    const dashboardLink = el('a', 'text-glow-400 hover:text-glow-300', 'dashboard')
    dashboardLink.href = '/dashboard'

    content.replaceChildren(
      isAdmin ? createInviteCard(data.family.invites) : '',
      el('div', CARD_CLASS,
        el('h2', 'text-lg font-semibold text-white mb-1', 'Members'),
        el('p', 'text-sm text-white/60 mb-4',
          `Your role: ${ROLE_NAMES[data.role]}. `,
          data.role === 'child' ? 'Your filters are on your ' : 'Change your own filters on your ',
          dashboardLink, '.'),
        isAdmin ? '' : el('div', 'mb-4', createRoleList()),
        ...data.family.members.map((member) => createMemberRow(member, isAdmin))),
      el('div', CARD_CLASS, createLeaveCard(data.role)),
    )
  }

  apiFetch('/family/').then(({ response, data }) => {
    if (!response.ok) {
      content.textContent = ''
      showError('Could not load your family. Please reload the page.')
      return
    }
    render(data)
  })

  return { el: container }
}
