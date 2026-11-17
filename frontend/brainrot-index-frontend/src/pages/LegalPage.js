// A page of legal text: a title, the date it took effect, and the body, which
// is static HTML written in this repository.

import { el } from '../lib/dom.js'

export function mountLegalPage({ title, effectiveDate, bodyHtml }) {
  const body = el('div', 'legal-text mt-8')
  body.innerHTML = bodyHtml
  const root = el('article', 'max-w-3xl mx-auto px-4 py-12',
    el('h1', 'text-3xl font-bold text-white', title),
    el('p', 'mt-2 text-sm text-white/50', `Effective ${effectiveDate}`),
    body)
  return { el: root }
}
