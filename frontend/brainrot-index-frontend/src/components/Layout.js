// Persistent app shell: nav + #page-outlet + footer.
// Returns { el, getOutlet() } so main.js can hand the outlet to the router.

import { getState, subscribe, logout } from '../lib/auth.js'
import { el } from '../lib/dom.js'
import { createFeedbackButton } from './FeedbackButton.js'
import { onNavigate, navigate } from '../lib/router.js'

// The git commit this build came from, passed in by deploy.sh.
const GIT_COMMIT = import.meta.env.VITE_GIT_COMMIT || 'unknown'

export function createLayout() {
  // -- Navigation --

  const logo = el('a', 'text-xl font-bold bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent', 'Brainrot Index')
  logo.href = '/'

  // Right slot: replaced on auth state changes
  const rightSlot = el('div', 'flex items-center gap-4')

  // -- Profile dropdown (created once, toggled) --
  let dropdownOpen = false

  const avatarBtn = el('button', 'w-9 h-9 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-sm font-bold hover:ring-2 hover:ring-amber-400/50 transition-all')

  const emailP = el('p', 'text-sm font-medium truncate')

  const dropdownLinkClass = 'block px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-colors'
  const dashboardLink = el('a', dropdownLinkClass, 'Dashboard')
  dashboardLink.href = '/dashboard'
  const storeLink = el('a', dropdownLinkClass, 'Plugin store')
  storeLink.href = '/store'
  const familyLink = el('a', dropdownLinkClass, 'Family')
  familyLink.href = '/family'
  const accountLink = el('a', dropdownLinkClass, 'Account settings')
  accountLink.href = '/account'

  const signOutBtn = el('button', 'w-full text-left px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/5 rounded-lg transition-colors', 'Sign Out')
  signOutBtn.addEventListener('click', async () => {
    await logout()
    // Returning the user to the landing page keeps the UI in a consistent
    // post-sign-out state: no lingering half-rendered protected page.
    closeDropdown()
    navigate('/')
  })

  const dropdown = el('div', 'absolute right-0 mt-2 w-72 bg-gray-900 border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50 hidden',
    el('div', 'px-4 py-3 border-b border-white/10', emailP),
    el('div', 'p-1', dashboardLink, storeLink, familyLink, accountLink, signOutBtn))

  const dropdownWrapper = el('div', 'relative', avatarBtn, dropdown)

  function openDropdown() {
    dropdownOpen = true
    dropdown.classList.remove('hidden')
  }

  function closeDropdown() {
    dropdownOpen = false
    dropdown.classList.add('hidden')
  }

  avatarBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    dropdownOpen ? closeDropdown() : openDropdown()
  })

  // Close when clicking outside
  document.addEventListener('mousedown', (e) => {
    if (dropdownOpen && !dropdownWrapper.contains(e.target)) {
      closeDropdown()
    }
  })

  const navStoreLink = el('a', 'text-sm text-white/70 hover:text-white transition-colors', 'Store')
  navStoreLink.href = '/store'

  const feedbackButton = createFeedbackButton()

  function renderNav() {
    const { isAuthenticated, email } = getState()

    if (isAuthenticated) {
      emailP.textContent = email || ''
      avatarBtn.textContent = email ? email[0].toUpperCase() : '?'

      rightSlot.replaceChildren(navStoreLink, dropdownWrapper)
    } else {
      closeDropdown()

      // One auth button, not two: the login page cross-links to signup, so
      // the nav stays uncluttered on mobile.
      const loginLink = el('a', 'px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black transition-all', 'Sign in')
      loginLink.href = '/login'

      rightSlot.replaceChildren(loginLink)
    }
  }

  subscribe(() => {
    renderNav()
  })

  // Close dropdown on route change
  onNavigate(() => {
    closeDropdown()
  })

  // -- Assemble shell --

  const nav = el('nav', 'border-b border-white/10 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50',
    el('div', 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8',
      el('div', 'flex items-center justify-between h-16',
        logo,
        rightSlot)))

  const outlet = el('main', 'flex-1')
  outlet.id = 'page-outlet'

  const footer = el('footer', 'border-t border-white/10 py-6 text-center text-sm text-white/40',
    el('p', '', 'Brainrot Index'),
    el('p', 'mt-1 text-xs text-white/25', `Version ${GIT_COMMIT}`))

  const shell = el('div', 'min-h-screen bg-gray-950 text-white flex flex-col',
    nav, outlet, footer, feedbackButton.el)

  // Initial render of nav right slot
  renderNav()

  return {
    el: shell,
    getOutlet() { return outlet },
  }
}
