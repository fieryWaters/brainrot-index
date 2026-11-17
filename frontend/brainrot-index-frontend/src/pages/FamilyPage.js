// Family page: start a family or enter an invite code; in a family, the
// members and their roles. A superadmin also changes roles, edits each
// member's settings and plugins, invites people and removes them.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { navigate } from '../lib/router.js'
import { ROLE_DESCRIPTIONS, ROLE_NAMES } from '../lib/roles.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { createFilterSettingsCard, createInstalledPluginsCard } from '../components/FilterSettings.js'
import {
  AMBER_BUTTON_CLASS, CARD_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS, SELECT_CLASS,
} from '../components/styles.js'

const ROLE_OPTIONS = ['superadmin', 'admin', 'child']

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
  function createStartCards() {
    const nameInput = el('input', INPUT_CLASS)
    nameInput.placeholder = 'The Smiths'
    nameInput.maxLength = 60
    nameInput.setAttribute('aria-label', 'Family name')
    const createFamilyButton = createButton(PRIMARY_BUTTON_CLASS + ' shrink-0', 'Start a family')
    createFamilyButton.addEventListener('click', async () => {
      const name = nameInput.value.trim()
      if (!name) {
        showError('Give your family a name first.')
        return
      }
      createFamilyButton.disabled = true
      await send('/family/', 'POST', { name }, 'Could not start the family. Please try again.')
      createFamilyButton.disabled = false
    })

    const codeInput = el('input', INPUT_CLASS)
    codeInput.placeholder = 'ABCDE-23456'
    codeInput.setAttribute('aria-label', 'Invite code')
    const codeButton = createButton(AMBER_BUTTON_CLASS + ' shrink-0', 'Continue')
    codeButton.addEventListener('click', () => {
      const code = codeInput.value.trim()
      if (!code) {
        showError('Enter the invite code you were given.')
        return
      }
      navigate(`/family/join?code=${encodeURIComponent(code)}`)
    })

    return [
      el('div', CARD_CLASS,
        el('h2', 'text-lg font-semibold text-white mb-1', 'Start a family'),
        el('p', 'text-sm text-white/60 mb-4',
          "You become its superadmin: you can change everyone's settings and plugins, and choose who else is a superadmin, an admin or a child."),
        el('div', 'flex flex-col sm:flex-row gap-3', nameInput, createFamilyButton)),
      el('div', CARD_CLASS,
        el('h2', 'text-lg font-semibold text-white mb-1', 'Have an invite code?'),
        el('p', 'text-sm text-white/60 mb-4', 'Enter the code someone in your family sent you.'),
        el('div', 'flex flex-col sm:flex-row gap-3', codeInput, codeButton)),
    ]
  }

  // -- Members --
  function createMemberRow(member, isSuperadmin) {
    const memberName = el('p', 'text-white truncate', member.email, member.is_you ? el('span', 'text-white/40', ' (you)') : '')

    if (!isSuperadmin) {
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

  // -- Invites (superadmin) --
  function createInviteCard(invites) {
    const roleSelect = createRoleSelect('child', 'Role for the invited person')
    const roleHelp = el('p', 'text-xs text-white/40', ROLE_DESCRIPTIONS.child)
    roleSelect.addEventListener('change', () => {
      roleHelp.textContent = ROLE_DESCRIPTIONS[roleSelect.value]
    })

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
      el('div', 'flex flex-col gap-1 mb-4',
        el('label', 'flex flex-col sm:flex-row sm:items-center gap-3',
          el('span', LABEL_CLASS, 'Joins as'),
          roleSelect,
          inviteButton),
        roleHelp),
      result,
      pending.length > 0 ? el('div', 'mt-4', el('p', LABEL_CLASS + ' mb-1', 'Waiting to be accepted'), ...pending) : '')
  }

  function createInviteResult(invite) {
    const link = inviteLinkFor(invite.code)
    const linkInput = el('input', INPUT_CLASS)
    linkInput.readOnly = true
    linkInput.value = link
    linkInput.setAttribute('aria-label', 'Invite link')
    const copyButton = createButton(AMBER_BUTTON_CLASS + ' shrink-0', 'Copy link')
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link)
        copyButton.textContent = 'Copied'
      } catch {
        linkInput.select()
        copyButton.textContent = 'Press Ctrl+C to copy'
      }
    })
    return el('div', 'rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col gap-3',
      el('p', 'text-sm text-white/70', `${ROLE_NAMES[invite.role]} invite created. It is shown only now, so copy it before leaving this page.`),
      el('div', 'flex flex-col sm:flex-row gap-3', linkInput, copyButton),
      el('p', 'text-sm text-white/60', 'Code: ', el('span', 'font-mono text-white', invite.code)))
  }

  // -- Leaving --
  function createLeaveCard(role) {
    if (role === 'child') {
      return el('p', 'text-sm text-white/50', 'To leave this family, ask a superadmin to remove you.')
    }
    const leaveButton = createConfirmButton('Leave family', 'Click again to leave', () =>
      send('/family/leave/', 'POST', undefined, 'Could not leave the family. Please try again.'))
    return el('div', 'flex items-center justify-between gap-4 text-sm',
      el('p', 'text-white/50', 'Your own settings and plugins stay as they are.'),
      leaveButton)
  }

  function render(data) {
    if (data.family === null) {
      content.replaceChildren(...createStartCards())
      return
    }

    const isSuperadmin = data.role === 'superadmin'
    const dashboardLink = el('a', 'text-amber-400 hover:text-amber-300', 'dashboard')
    dashboardLink.href = '/dashboard'

    content.replaceChildren(
      el('div', CARD_CLASS,
        el('h2', 'text-lg font-semibold text-white mb-1', data.family.name),
        el('p', 'text-sm text-white/60 mb-4',
          `Your role: ${ROLE_NAMES[data.role]}. ${ROLE_DESCRIPTIONS[data.role]} `,
          data.role === 'child' ? 'Your filters are on your ' : 'Change your own filters on your ',
          dashboardLink, '.'),
        ...data.family.members.map((member) => createMemberRow(member, isSuperadmin))),
      isSuperadmin ? createInviteCard(data.family.invites) : '',
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
