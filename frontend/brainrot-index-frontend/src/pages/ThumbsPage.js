// Every reader's thumbs up or down on a post, one compact row each, newest
// first: the labeled examples new filters are measured against. Each row shows
// the verdict, how the post was shown, the filter the verdict is about, a
// snippet of the post, and what every filter decided when it was judged. The
// row's id opens the full item. Above the table, the count of thumbs up and
// down for each filter. The server refuses everyone but the owner.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { QUIET_BUTTON_CLASS } from '../components/styles.js'
import { senderText } from './InboxPage.js'

const NO_FILTER_NAMED = '(no filter named)'

const VERDICT_TEXT = {
  right: 'up',
  wrong: 'down',
}

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleString(undefined, { month: 'short', day: 'numeric' })
}

function filterDecisionText(filter) {
  let score = filter.status
  if (filter.score !== null) {
    score = `${filter.score}/${filter.threshold}`
  }
  const decision = filter.flagged ? filter.flagged_action : 'allow'
  return `${filter.plugin} v${filter.version} ${score} ${decision}`
}

// How many thumbs up and down each filter has, by the filter the verdict is about.
function createCountsLine(thumbs) {
  const counts = {}
  for (const thumb of thumbs) {
    const plugin = thumb.plugin || NO_FILTER_NAMED
    if (!counts[plugin]) {
      counts[plugin] = { right: 0, wrong: 0 }
    }
    counts[plugin][thumb.verdict] += 1
  }
  const parts = Object.keys(counts).sort().map((plugin) => `${plugin}: ${counts[plugin].right} up, ${counts[plugin].wrong} down`)
  return el('p', 'mb-4 text-xs text-white/60', `${thumbs.length} thumbs. ${parts.join('; ')}`)
}

function createThumbRow(thumb) {
  const idLink = el('a', 'text-glow-400 hover:text-glow-300', thumb.id)
  idLink.href = `/inbox/${thumb.id}`
  const postLink = el('a', 'text-white/80 hover:text-white line-clamp-2', thumb.post.text || '(no text)')
  postLink.href = thumb.post.url
  postLink.target = '_blank'
  postLink.rel = 'noopener noreferrer'

  const verdictClass = thumb.verdict === 'right' ? 'text-glow-300' : 'text-red-300'
  return el('tr', 'border-t border-white/10 align-top',
    el('td', 'py-1.5 pr-3 whitespace-nowrap', idLink, el('div', 'text-white/40', formatDate(thumb.received_at))),
    el('td', `py-1.5 pr-3 whitespace-nowrap ${verdictClass}`, VERDICT_TEXT[thumb.verdict]),
    el('td', 'py-1.5 pr-3 whitespace-nowrap', thumb.shown_action),
    el('td', 'py-1.5 pr-3 whitespace-nowrap', thumb.plugin || '-'),
    el('td', 'py-1.5 pr-3 max-w-xs', postLink, el('div', 'text-white/40', `${thumb.post.platform} ${thumb.post.kind}`)),
    el('td', 'py-1.5 pr-3 whitespace-nowrap',
      ...thumb.filters.map((filter) => el('div', '', filterDecisionText(filter)))),
    el('td', 'py-1.5 pr-3 max-w-xs text-white/60', thumb.details,
      el('div', 'text-white/40', senderText({ ...thumb, kind: 'judgment' }))))
}

export function mountThumbsPage() {
  const content = el('div', '', el('p', 'text-sm text-white/50', 'Loading...'))
  const notesLink = el('a', QUIET_BUTTON_CLASS, 'Inbox')
  notesLink.href = '/inbox'
  const container = el('div', 'max-w-7xl mx-auto px-4 py-12',
    el('div', 'flex flex-wrap items-center justify-between gap-4 mb-6',
      el('h1', 'text-3xl font-bold text-white', 'Post thumbs'), notesLink),
    content)

  async function showThumbs() {
    const { response, data } = await apiFetch('/inbox/thumbs/')
    if (!response.ok) {
      let message = errorMessageFrom(data, `The thumbs could not load: error ${response.status}.`)
      if (response.status === 403) {
        message = 'The inbox is only for the site owner, signed in with Google.'
      }
      content.replaceChildren(createErrorBanner(message))
      return
    }
    if (data.thumbs.length === 0) {
      content.replaceChildren(el('p', 'text-sm text-white/50', 'No thumbs yet.'))
      return
    }
    const table = el('table', 'w-full text-left text-xs text-white/70',
      el('thead', '', el('tr', 'text-white/40',
        el('th', 'pb-1 pr-3 font-medium', 'Item'),
        el('th', 'pb-1 pr-3 font-medium', 'Thumbs'),
        el('th', 'pb-1 pr-3 font-medium', 'Shown'),
        el('th', 'pb-1 pr-3 font-medium', 'About filter'),
        el('th', 'pb-1 pr-3 font-medium', 'Post'),
        el('th', 'pb-1 pr-3 font-medium', 'Filters: score/threshold, decision'),
        el('th', 'pb-1 pr-3 font-medium', 'Note and sender'))),
      el('tbody', '', ...data.thumbs.map(createThumbRow)))
    content.replaceChildren(createCountsLine(data.thumbs), el('div', 'overflow-x-auto', table))
  }

  showThumbs()
  return { el: container }
}
