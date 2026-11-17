// Landing page: the product name, one sentence about what it does, the two
// ways in, and the price.

import { el } from '../lib/dom.js'

export function mountLandingPage() {
  const signupLink = el('a',
    'px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black transition-all',
    'Sign up')
  signupLink.href = '/signup'

  const loginLink = el('a',
    'px-6 py-3 rounded-xl font-medium bg-white/10 hover:bg-white/20 transition-colors',
    'Log in')
  loginLink.href = '/login'

  const root = el('div', 'flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center px-4 py-10 text-center',
    el('h1',
      'max-w-3xl text-4xl font-bold leading-tight sm:text-5xl bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 bg-clip-text text-transparent',
      'Brainrot Index'),
    el('p', 'mt-4 max-w-xl text-lg text-white/70',
      'Filter brainrot, ragebait, and engagement bait out of your feeds.'),
    el('div', 'mt-8 flex gap-4 justify-center', signupLink, loginLink),
    el('section', 'mt-14 w-full max-w-sm rounded-2xl border border-white/10 bg-black/30 p-6',
      el('h2', 'text-sm font-semibold uppercase tracking-wide text-white/50', 'Pricing'),
      el('p', 'mt-3 text-4xl font-bold text-white', '$5',
        el('span', 'text-lg font-medium text-white/50', ' / month')),
      el('p', 'mt-3 text-white/70', 'Free for 7 days. No card needed to start.'),
      el('p', 'mt-1 text-sm text-white/50', 'Cancel any time.')),
  )

  return { el: root }
}
