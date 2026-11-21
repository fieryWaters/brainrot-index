// The owner's inbox: notes from people, newest first: feedback reports,
// contact messages and readers' thumbs on posts that carry a written note.
// Each item shows who sent it, what they said, the post it is about with what
// every filter decided, and a form to mark it resolved with the fixing commit
// and a note, both optional. /inbox/<item id> shows one item, which is where
// the emailed alerts link. Every thumbs on a post, noted or not, is listed at
// /inbox/thumbs. The server refuses everyone but the owner (the account the
// admin lets in).

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { ACCENT_BUTTON_CLASS, CARD_CLASS, INPUT_CLASS, QUIET_BUTTON_CLASS } from '../components/styles.js'

const STATUS_TABS = [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']]
const TAB_CLASS = 'px-3 py-1.5 rounded-lg text-sm transition-colors'
const TAB_IDLE_CLASS = 'text-white/60 hover:text-white hover:bg-white/5'
const TAB_CHOSEN_CLASS = 'bg-shield-400/25 text-glow-300'

const SOURCE_TITLES = {
  site: 'Feedback from the website',
  extension: 'Report from the extension',
  contact: 'Contact',
}
const VERDICT_TITLES = {
  right: 'Thumbs up on a post',
  wrong: 'Thumbs down on a post',
}

function formatDateTime(isoDate) {
  return new Date(isoDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function itemTitle(item) {
  if (item.kind === 'judgment') {
    return VERDICT_TITLES[item.verdict]
  }
  if (item.source === 'contact') {
    return `Contact: ${item.subject}`
  }
  if (item.rating) {
    return `${SOURCE_TITLES[item.source]}: thumbs ${item.rating}`
  }
  return SOURCE_TITLES[item.source]
}

export function senderText(item) {
  const sender = item.sender
  // Thumbs on posts come only from accounts, so one without a sender is from a deleted account.
  if (item.kind === 'judgment' && !sender.email) {
    return 'Deleted account'
  }
  let text = sender.email || 'no address'
  if (sender.name) {
    text = `${sender.name} <${text}>`
  }
  if (!sender.signed_in) {
    text += ' (not signed in)'
  }
  return text
}

// The thumbs' label: "Shown", "Blocked as shouting", or "Blocked as Other" when no filter covers it.
export function labelText(thumb) {
  if (thumb.should_be === 'shown') return 'Shown'
  return `Blocked as ${thumb.plugin || 'Other'}`
}

// The facts about an item that are not its message, one short line each.
function detailLines(item) {
  const lines = []
  if (item.kind === 'judgment') {
    lines.push(`Shown as: ${item.shown_action}`)
    lines.push(`Label: ${labelText(item)}`)
    if (item.severity) lines.push(`Severity: ${item.severity}`)
  } else {
    if (item.shown_action || item.expected_action) {
      lines.push(`Shown: ${item.shown_action || '-'}, expected: ${item.expected_action || '-'}`)
    }
    if (item.post_id && !item.post) lines.push(`Post ${item.platform} ${item.post_id} (never stored)`)
    if (item.page_url) lines.push(`Page: ${item.page_url}`)
    lines.push(`Site version: ${item.site_commit}`)
  }
  if (item.extension_commit) lines.push(`Extension version: ${item.extension_commit}`)
  return lines
}

function createPostBlock(post) {
  const postLink = el('a', 'text-glow-400 hover:text-glow-300', 'Open the post')
  postLink.href = post.url
  postLink.target = '_blank'
  postLink.rel = 'noopener noreferrer'

  const block = el('div', 'mt-4 rounded-xl border border-white/10 bg-black/30 p-4',
    el('p', 'text-xs text-white/50', `${post.platform} ${post.kind} by ${post.author || 'unknown'}${post.community ? ` in ${post.community}` : ''} - `, postLink))
  if (post.parent_text) {
    block.appendChild(el('p', 'mt-2 text-xs text-white/40 whitespace-pre-wrap', `Replying to: ${post.parent_text}`))
  }
  block.appendChild(el('p', 'mt-2 text-sm text-white/90 whitespace-pre-wrap', post.text || '(no text)'))
  if (post.images.length > 0) {
    const images = el('div', 'mt-3 flex flex-wrap gap-2')
    for (const image of post.images) {
      const img = el('img', 'h-32 rounded-lg border border-white/10 object-cover')
      img.src = image.source_url
      img.alt = 'Image in the post'
      img.loading = 'lazy'
      img.referrerPolicy = 'no-referrer'
      images.appendChild(img)
    }
    block.appendChild(images)
  }
  if (post.video) {
    block.appendChild(el('p', 'mt-2 text-xs text-white/50', `Video: ${post.video.status}${post.video.duration_seconds ? `, ${post.video.duration_seconds} s` : ''}`))
  }
  if (post.transcript && post.transcript.text) {
    block.appendChild(el('p', 'mt-2 text-xs text-white/50 whitespace-pre-wrap line-clamp-4', `Transcript: ${post.transcript.text}`))
  }
  return block
}

// The filter and what decided it: a rubric version, or the feature set whose ratings it is a formula over.
export function filterNameText(filter) {
  if (filter.feature_set) {
    return `${filter.plugin} (features v${filter.feature_set})`
  }
  return `${filter.plugin} v${filter.version}`
}

function createFiltersTable(filters) {
  const rows = filters.map((filter) => {
    let score = filter.status
    if (filter.score !== null) {
      score = `${filter.score} / ${filter.threshold}`
    }
    const metCriteria = filter.criteria.filter((criterion) => criterion.met).map((criterion) => criterion.name)
    const decision = filter.flagged ? `flagged, ${filter.flagged_action}` : 'not flagged'
    return el('tr', 'border-t border-white/10 align-top',
      el('td', 'py-2 pr-3 text-white/90', filterNameText(filter)),
      el('td', 'py-2 pr-3 whitespace-nowrap', score),
      el('td', 'py-2 pr-3 whitespace-nowrap', decision),
      el('td', 'py-2 text-white/60',
        metCriteria.length > 0 ? `Met: ${metCriteria.join(', ')}. ` : '',
        filter.reasoning))
  })
  return el('table', 'mt-4 w-full text-left text-xs text-white/70',
    el('thead', '', el('tr', 'text-white/40',
      el('th', 'pb-1 pr-3 font-medium', 'Filter'),
      el('th', 'pb-1 pr-3 font-medium', 'Score / threshold'),
      el('th', 'pb-1 pr-3 font-medium', 'Decision'),
      el('th', 'pb-1 font-medium', 'Criteria and reasoning'))),
    el('tbody', '', ...rows))
}

function createResolveForm(item, onResolved) {
  const commitInput = el('input', `${INPUT_CLASS} sm:w-40`)
  commitInput.placeholder = 'Commit (optional)'
  commitInput.setAttribute('aria-label', 'Fixing commit')
  const noteInput = el('input', INPUT_CLASS)
  noteInput.placeholder = 'What was wrong and what changed (optional)'
  noteInput.setAttribute('aria-label', 'Resolution note')
  const resolveButton = el('button', `${ACCENT_BUTTON_CLASS} whitespace-nowrap`, 'Mark resolved')
  resolveButton.type = 'submit'
  const status = el('p', 'text-xs text-red-400')

  const form = el('form', 'mt-4 flex flex-col gap-2',
    el('div', 'flex flex-col sm:flex-row gap-2', commitInput, noteInput, resolveButton),
    status)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    resolveButton.disabled = true
    const { response, data } = await apiFetch(`/inbox/${item.id}/resolve/`, {
      method: 'POST',
      body: { commit: commitInput.value.trim(), note: noteInput.value.trim() },
    })
    resolveButton.disabled = false
    if (response.ok) {
      onResolved(data)
    } else {
      status.textContent = errorMessageFrom(data, `Not resolved: the server answered with error ${response.status}.`)
    }
  })
  return form
}

function createItemCard(item, onResolved) {
  const titleLink = el('a', 'text-lg font-semibold text-white hover:text-glow-300', itemTitle(item))
  titleLink.href = `/inbox/${item.id}`

  const card = el('article', CARD_CLASS,
    el('div', 'flex flex-wrap items-baseline justify-between gap-2',
      titleLink,
      el('span', 'text-xs text-white/40', `${item.id} - ${formatDateTime(item.received_at)}`)),
    el('p', 'mt-1 text-sm text-white/60', senderText(item)))

  const message = item.kind === 'judgment' ? item.details : item.text
  if (message) {
    card.appendChild(el('p', 'mt-3 text-sm text-white whitespace-pre-wrap', message))
  }
  card.appendChild(el('ul', 'mt-3 text-xs text-white/50 space-y-0.5',
    ...detailLines(item).map((line) => el('li', 'break-all', line))))
  if (item.post) {
    card.appendChild(createPostBlock(item.post))
  }
  if (item.filters.length > 0) {
    card.appendChild(createFiltersTable(item.filters))
  }

  if (item.resolved) {
    const commitText = item.resolved_commit ? ` in ${item.resolved_commit}` : ''
    const noteText = item.resolved_note ? `: ${item.resolved_note}` : ''
    card.appendChild(el('p', 'mt-4 text-sm text-glow-300', `Resolved${commitText}${noteText}`))
  } else {
    card.appendChild(createResolveForm(item, onResolved))
  }
  return card
}

export function mountInboxPage({ itemId } = {}) {
  const content = el('div', '', el('p', 'text-sm text-white/50', 'Loading...'))
  const tabs = el('div', 'flex gap-1 mb-6')
  const thumbsLink = el('a', QUIET_BUTTON_CLASS, 'Post thumbs')
  thumbsLink.href = '/inbox/thumbs'
  const headerLinks = el('div', 'flex gap-2', thumbsLink)
  const header = el('div', 'flex flex-wrap items-center justify-between gap-4 mb-6',
    el('h1', 'text-3xl font-bold text-white', 'Inbox'), headerLinks)
  const container = el('div', 'max-w-4xl mx-auto px-4 py-12', header, content)

  function showRefusal(response, data) {
    let message = errorMessageFrom(data, `The inbox could not load: error ${response.status}.`)
    if (response.status === 403) {
      message = 'The inbox is only for the site owner, signed in with Google.'
    }
    content.replaceChildren(createErrorBanner(message))
  }

  async function showOneItem() {
    const allLink = el('a', QUIET_BUTTON_CLASS, 'All open items')
    allLink.href = '/inbox'
    headerLinks.prepend(allLink)
    const { response, data } = await apiFetch(`/inbox/${itemId}/`)
    if (!response.ok) {
      showRefusal(response, data)
      return
    }
    const render = (item) => content.replaceChildren(createItemCard(item, render))
    render(data)
  }

  async function showList(status) {
    tabs.replaceChildren(...STATUS_TABS.map(([value, label]) => {
      const tab = el('button', `${TAB_CLASS} ${value === status ? TAB_CHOSEN_CLASS : TAB_IDLE_CLASS}`, label)
      tab.type = 'button'
      tab.addEventListener('click', () => showList(value))
      return tab
    }))
    content.replaceChildren(el('p', 'text-sm text-white/50', 'Loading...'))
    const { response, data } = await apiFetch(`/inbox/?status=${status}`)
    if (!response.ok) {
      showRefusal(response, data)
      return
    }
    if (data.items.length === 0) {
      content.replaceChildren(tabs, el('p', 'text-sm text-white/50', 'Nothing here.'))
      return
    }
    const cards = data.items.map((item) => {
      const card = createItemCard(item, (resolvedItem) => {
        // A resolved item leaves the Open list; elsewhere it shows its resolution.
        if (status === 'open') {
          card.remove()
        } else {
          card.replaceWith(createItemCard(resolvedItem, () => {}))
        }
      })
      return card
    })
    content.replaceChildren(tabs, ...cards)
  }

  if (itemId) {
    showOneItem()
  } else {
    showList('open')
  }
  return { el: container }
}
