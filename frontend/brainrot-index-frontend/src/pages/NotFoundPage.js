// The page for an address the site does not have. It asks search engines not
// to index it, since the server answers every address with the app.

import { el } from '../lib/dom.js'

const PRIMARY_LINK_CLASS = 'px-5 py-2.5 rounded-xl font-semibold bg-gradient-to-r from-shield-400 to-shield-600 hover:to-shield-400 hover:shadow-lg hover:shadow-glow-400/20 text-white transition-all'
const SECONDARY_LINK_CLASS = 'px-5 py-2.5 rounded-xl font-medium bg-white/10 hover:bg-white/20 transition-colors'

export function mountNotFoundPage() {
  const homeLink = el('a', PRIMARY_LINK_CLASS, 'Go to the home page')
  homeLink.href = '/'
  const installLink = el('a', SECONDARY_LINK_CLASS, 'Install the extension')
  installLink.href = '/install'

  const robotsMeta = document.createElement('meta')
  robotsMeta.name = 'robots'
  robotsMeta.content = 'noindex'
  document.head.appendChild(robotsMeta)

  const root = el('div', 'max-w-xl mx-auto px-4 py-24 text-center',
    el('p', 'text-sm font-semibold uppercase tracking-wide text-glow-400', '404'),
    el('h1', 'mt-2 text-3xl font-bold text-white', 'This page does not exist'),
    el('p', 'mt-3 text-white/60', 'The link may be old, or the address may have a typo.'),
    el('div', 'mt-8 flex flex-wrap gap-3 justify-center', homeLink, installLink))

  return {
    el: root,
    cleanup() {
      robotsMeta.remove()
    },
  }
}
