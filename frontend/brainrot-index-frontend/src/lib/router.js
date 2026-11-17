// Minimal History API SPA router - singleton module.
// Each route is stored as { regex, paramNames, handler, requiresAuth }.
// Handlers return { el, cleanup? }. Router manages cleanup lifecycle.

const routes = []
let outletEl = null
let currentCleanup = null
// Optional gate: when set, routes registered with { requiresAuth: true } are
// only reachable for authenticated users. A logged-out deep-link to such a
// route bounces to '/' instead of rendering a half-broken protected page.
let authGuard = null
// Renders a path no route matches. Set by main.js.
let notFoundHandler = null
// The title index.html gives the site; a route's own title is put in front of it.
const SITE_TITLE = document.title
const navigationCallbacks = []

// Convert /create/:imageId style pattern to regex + param name list.
// /create/:imageId -> regex /^\/create\/([^/]+)\/?$/, paramNames ['imageId']
function patternToRegex(pattern) {
  const paramNames = []
  const regexStr = pattern
    .replace(/:([^/]+)/g, (_, name) => {
      paramNames.push(name)
      return '([^/]+)'
    })
    .replace(/\//g, '\\/')
  return { regex: new RegExp(`^${regexStr}\\/?$`), paramNames }
}

export function register(pattern, handler, options = {}) {
  const { regex, paramNames } = patternToRegex(pattern)
  routes.push({
    regex,
    paramNames,
    handler,
    requiresAuth: Boolean(options.requiresAuth),
    title: options.title || '',
  })
}

export function navigate(path) {
  history.pushState({}, '', path)
  resolve()
  // Programmatic navigation lands a fresh page - start it at the top.
  // popstate (back/forward) deliberately skips this so the browser can
  // restore the previous scroll position.
  window.scrollTo(0, 0)
}

// Replace the current history entry (no new back-step) and re-resolve. Used by
// the auth guard so a blocked deep-link is replaced by the redirect target
// rather than leaving a junk history entry that bounces the user back to the
// blocked page on Back.
function redirect(path) {
  try {
    window.history.replaceState({}, '', path)
  } catch {
    // URL sync is non-critical in restricted contexts (e.g. some tests).
  }
  resolve()
}

export function setAuthGuard(fn) {
  authGuard = typeof fn === 'function' ? fn : null
}

export function resolve() {
  const pathname = window.location.pathname

  // Fire navigation callbacks first (e.g. close dropdown, update nav links)
  navigationCallbacks.forEach((fn) => fn(pathname))

  // Run cleanup from previous page
  if (currentCleanup) {
    currentCleanup()
    currentCleanup = null
  }

  if (!outletEl) return

  for (const route of routes) {
    const match = pathname.match(route.regex)
    if (!match) continue

    // Build params object from captured groups
    const params = {}
    route.paramNames.forEach((name, i) => {
      params[name] = match[i + 1]
    })

    if (route.requiresAuth && authGuard && !authGuard()) {
      redirect('/')
      return
    }

    setPageTitle(route.title)
    const result = route.handler(params)
    if (result) {
      outletEl.replaceChildren(result.el)
      currentCleanup = result.cleanup || null
    }
    return
  }

  setPageTitle('Page not found')
  if (notFoundHandler) {
    const result = notFoundHandler()
    outletEl.replaceChildren(result.el)
    currentCleanup = result.cleanup || null
    return
  }
  outletEl.innerHTML = '<div class="text-center py-20 text-white/50">404 - Page not found</div>'
}

function setPageTitle(title) {
  if (title) {
    document.title = `${title} - BrainRot Index`
  } else {
    document.title = SITE_TITLE
  }
}

export function setNotFoundHandler(fn) {
  notFoundHandler = fn
}

export function setOutlet(el) {
  outletEl = el
}

// Register a callback fired after every navigation.
// Used by Layout to close dropdown and update active nav link classes, and by
// main.js for page-view tracking.
export function onNavigate(fn) {
  navigationCallbacks.push(fn)
}

// Test-only: reset the singleton's accumulated routes/callbacks so guard tests
// can run in isolation against a clean route table.
export function _resetRoutesForTesting() {
  routes.length = 0
  navigationCallbacks.length = 0
  authGuard = null
  notFoundHandler = null
  if (currentCleanup) {
    currentCleanup()
  }
  currentCleanup = null
}
