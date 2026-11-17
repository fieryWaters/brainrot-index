import './index.css'
import { register, navigate, resolve, setOutlet, setAuthGuard } from './lib/router.js'
import { refreshSession, getState } from './lib/auth.js'
import { createLayout } from './components/Layout.js'
import { mountLandingPage } from './pages/LandingPage.js'
import { mountLoginPage } from './pages/LoginPage.js'
import { mountSignupPage } from './pages/SignupPage.js'
import { mountForgotPasswordPage } from './pages/ForgotPasswordPage.js'
import { mountResetPasswordPage } from './pages/ResetPasswordPage.js'
import { mountVerifyEmailPage } from './pages/VerifyEmailPage.js'
import { mountAccountPage } from './pages/AccountPage.js'
import { mountDashboardPage } from './pages/DashboardPage.js'
import { mountStorePage } from './pages/StorePage.js'
import { mountPublishPluginPage } from './pages/PublishPluginPage.js'
import { mountPluginPage } from './pages/PluginPage.js'
import { mountFamilyPage } from './pages/FamilyPage.js'
import { mountJoinFamilyPage } from './pages/JoinFamilyPage.js'

// Build the persistent shell and mount it into #root
const layout = createLayout()
document.getElementById('root').appendChild(layout.el)

// Hand the router a stable reference to the page outlet div
setOutlet(layout.getOutlet())

// Register all routes. Account routes require an authenticated session; a
// logged-out deep-link bounces to '/'.
register('/', mountLandingPage)
register('/login', mountLoginPage)
register('/signup', mountSignupPage)
register('/forgot-password', mountForgotPasswordPage)
register('/reset-password', mountResetPasswordPage)
register('/verify-email', mountVerifyEmailPage)
register('/account', mountAccountPage, { requiresAuth: true })
register('/dashboard', mountDashboardPage, { requiresAuth: true })
register('/store', mountStorePage, { requiresAuth: true })
register('/store/publish', mountPublishPluginPage, { requiresAuth: true })
register('/store/:slug', mountPluginPage, { requiresAuth: true })
register('/family', mountFamilyPage, { requiresAuth: true })
// Open to people who are signed out, so an invite link can ask them to sign in.
register('/family/join', mountJoinFamilyPage)

// Centralized auth gate: protected routes redirect to '/' when there's no
// session. Reads live state so a fresh refreshSession() on boot is honored.
setAuthGuard(() => getState().isAuthenticated)

// Back/forward navigation
window.addEventListener('popstate', resolve)

// Intercept internal <a> clicks so the SPA router handles them
document.addEventListener('click', (event) => {
  if (event.defaultPrevented) return
  const anchor = event.target.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('mailto:')) return
  // Skip download links
  if (anchor.hasAttribute('download')) return
  event.preventDefault()
  navigate(href)
})

// Learn who is logged in before mounting the initial page.
refreshSession().then(() => resolve())
