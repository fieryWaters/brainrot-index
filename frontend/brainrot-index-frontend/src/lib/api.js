const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function readCsrfCookie() {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

async function ensureCsrfCookie() {
  if (readCsrfCookie()) return
  try {
    await fetch(`${API_BASE_URL}/auth/csrf/`, { credentials: 'include' })
  } catch {
    // CSRF bootstrap is best-effort; the unsafe request will surface any real failure.
  }
}

export async function apiFetch(endpoint, { method = 'GET', body, headers = {}, signal } = {}) {
  const requestHeaders = { ...headers }
  if (body && !(body instanceof FormData)) {
    requestHeaders['Content-Type'] = 'application/json'
  }

  if (UNSAFE_METHODS.has(method.toUpperCase())) {
    await ensureCsrfCookie()
    const csrf = readCsrfCookie()
    if (csrf) requestHeaders['X-CSRFToken'] = csrf
  }

  let response
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      headers: requestHeaders,
      credentials: 'include',
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch {
    // Network failure / invalid URL (e.g. on a page that shouldn't fetch at
    // all, or offline): surface as a non-ok response so callers' existing
    // !response.ok handling applies instead of throwing unhandled.
    return { response: { ok: false, status: 0 }, data: {} }
  }

  const data = await response.json().catch(() => ({}))
  return { response, data }
}
