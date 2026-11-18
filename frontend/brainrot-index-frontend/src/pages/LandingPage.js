// Landing page: an advertisement, not a manual. The glowing shield, the
// tagline, why it is worth trying, and one way in.

import { el } from '../lib/dom.js'
import { getState } from '../lib/auth.js'
import { PRICE_PER_MONTH, TRIAL_DAYS } from '../lib/site.js'
import { createLogoMark } from '../components/LogoMark.js'

const PRIMARY_LINK_CLASS = 'inline-block px-7 py-3.5 rounded-xl text-lg font-bold bg-gradient-to-r from-shield-400 to-shield-600 hover:to-shield-400 hover:shadow-lg hover:shadow-glow-400/20 text-white transition-all'
const GLOW_TEXT_CLASS = 'bg-gradient-to-r from-glow-200 via-glow-300 to-glow-400 bg-clip-text text-transparent'

function link(className, text, href) {
  const anchor = el('a', className, text)
  anchor.href = href
  return anchor
}

// The main call to action: sign up, or the dashboard for someone signed in.
function startLink() {
  if (getState().isAuthenticated) return link(PRIMARY_LINK_CLASS, 'Go to your dashboard', '/dashboard')
  return link(PRIMARY_LINK_CLASS, `Start your free ${TRIAL_DAYS}-day trial`, '/signup')
}

function trialNote() {
  return el('p', 'mt-4 text-sm text-white/50 text-balance', `${TRIAL_DAYS} days free, no card needed. Then ${PRICE_PER_MONTH} a month.`)
}

// The tagline breaks after "algorithm" and nowhere else. Its size follows the
// screen width so "that works for you" always fits on one line.
function tagline() {
  return el('h1', `text-[clamp(1.9rem,8.4vw,4.75rem)] font-extrabold leading-[1.08] tracking-tight ${GLOW_TEXT_CLASS}`,
    el('span', 'block whitespace-nowrap', 'The algorithm'),
    el('span', 'block whitespace-nowrap', 'that works for you'))
}

// The shield with its light spilling out behind it.
function glowingShield() {
  return el('div', 'relative mx-auto w-40 h-40 sm:w-56 sm:h-56',
    el('div', 'absolute -inset-10 rounded-full bg-glow-400/20 blur-3xl'),
    createLogoMark('relative w-full h-full'))
}

function heroSection() {
  return el('section', 'min-h-[calc(100svh-4rem)] flex flex-col items-center justify-center px-4 py-16 text-center',
    glowingShield(),
    el('div', 'mt-12', tagline()),
    el('p', 'mt-6 max-w-xl text-lg sm:text-xl text-white/70 text-balance',
      'Your feed was built to keep you hooked. Take your attention back.'),
    el('div', 'mt-10', startLink()),
    trialNote())
}

export function mountLandingPage() {
  // The logo's navy, lit from above, behind the top of the page.
  const root = el('div', 'overflow-hidden bg-[radial-gradient(ellipse_70%_900px_at_50%_0%,var(--color-navy-800),transparent)]',
    heroSection())
  return { el: root }
}
