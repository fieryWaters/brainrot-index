import './index.css'
import { register, navigate, resolve, setOutlet, setAuthGuard, setNotFoundHandler } from './lib/router.js'
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
import { mountBillingSuccessPage, mountBillingCanceledPage } from './pages/BillingReturnPages.js'
import { mountStorePage } from './pages/StorePage.js'
import { mountPublishPluginPage } from './pages/PublishPluginPage.js'
import { mountPluginPage } from './pages/PluginPage.js'
import { mountFamilyPage } from './pages/FamilyPage.js'
import { mountJoinFamilyPage } from './pages/JoinFamilyPage.js'
import { mountInstallPage } from './pages/InstallPage.js'
import { mountPrivacyPage } from './pages/PrivacyPage.js'
import { mountTermsPage } from './pages/TermsPage.js'
import { mountContactPage } from './pages/ContactPage.js'
import { mountInboxPage } from './pages/InboxPage.js'
import { mountThumbsPage } from './pages/ThumbsPage.js'
import { mountNotFoundPage } from './pages/NotFoundPage.js'

// Build the persistent shell and mount it into #root
const layout = createLayout()
document.getElementById('root').appendChild(layout.el)

// Hand the router a stable reference to the page outlet div
setOutlet(layout.getOutlet())

// Register all routes. Account routes require an authenticated session; a
// logged-out deep-link bounces to '/'.
register('/', mountLandingPage)
register('/login', mountLoginPage, { title: 'Sign in' })
register('/signup', mountSignupPage, { title: 'Create account' })
register('/forgot-password', mountForgotPasswordPage, { title: 'Forgot password' })
register('/reset-password', mountResetPasswordPage, { title: 'Reset password' })
register('/verify-email', mountVerifyEmailPage, { title: 'Verify email' })
register('/install', mountInstallPage, { title: 'Install the extension' })
register('/privacy', mountPrivacyPage, { title: 'Privacy Policy' })
register('/terms', mountTermsPage, { title: 'Terms of Service' })
register('/contact', mountContactPage, { title: 'Contact us' })
register('/account', mountAccountPage, { requiresAuth: true, title: 'Account' })
register('/dashboard', mountDashboardPage, { requiresAuth: true, title: 'Dashboard' })
register('/billing/success', mountBillingSuccessPage, { requiresAuth: true })
register('/billing/canceled', mountBillingCanceledPage, { requiresAuth: true })
register('/store', mountStorePage, { requiresAuth: true, title: 'Plugin store' })
register('/store/publish', mountPublishPluginPage, { requiresAuth: true, title: 'Publish a plugin' })
register('/store/:slug', mountPluginPage, { requiresAuth: true, title: 'Plugin store' })
register('/family', mountFamilyPage, { requiresAuth: true, title: 'Family' })
// Open to people who are signed out, so an invite link can ask them to sign in.
register('/family/join', mountJoinFamilyPage, { title: 'Join a family' })
// The owner's inbox; the server refuses everyone else.
register('/inbox', mountInboxPage, { requiresAuth: true, title: 'Inbox' })
register('/inbox/thumbs', mountThumbsPage, { requiresAuth: true, title: 'Post thumbs' })
register('/inbox/:itemId', mountInboxPage, { requiresAuth: true, title: 'Inbox' })

// Centralized auth gate: protected routes redirect to '/' when there's no
// session. Reads live state so a fresh refreshSession() on boot is honored.
setAuthGuard(() => getState().isAuthenticated)
setNotFoundHandler(mountNotFoundPage)

// Back/forward navigation
window.addEventListener('popstate', resolve)

// Intercept internal <a> clicks so the SPA router handles them
document.addEventListener('click', (event) => {
  if (event.defaultPrevented) return
  const anchor = event.target.closest('a')
  if (!anchor) return
  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('mailto:') || href.startsWith('#')) return
  // Skip download links
  if (anchor.hasAttribute('download')) return
  event.preventDefault()
  navigate(href)
})

// Learn who is logged in before mounting the initial page.
refreshSession().then(() => resolve())
