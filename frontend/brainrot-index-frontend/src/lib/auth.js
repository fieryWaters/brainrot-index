import { apiFetch } from './api'

// Empty when Google Sign-In is not configured; pages then show no Google button.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const APP_ENV = String(import.meta.env.VITE_APP_ENV || 'deployment').trim().toLowerCase()
const LOCAL_AUTH_MODE = APP_ENV === 'local'

let _state = {
  email: '',
  emailVerified: false,
  authProvider: '',
  authError: '',
  isAuthenticated: false,
  serverUnavailable: false,
}

let _listeners = new Set()

export function getState() {
  return { ..._state }
}

function setState(patch) {
  _state = { ..._state, ...patch }
  _listeners.forEach((fn) => fn(_state))
}

function applySession(data) {
  setState({
    email: data.email || '',
    emailVerified: Boolean(data.email_verified),
    authProvider: data.auth_provider || '',
    authError: '',
    isAuthenticated: true,
  })
}

function clearState() {
  setState({
    email: '',
    emailVerified: false,
    authProvider: '',
    isAuthenticated: LOCAL_AUTH_MODE,
  })
}

export function subscribe(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

export function _resetForTesting() {
  _state = {
    email: '',
    emailVerified: false,
    authProvider: '',
    authError: '',
    isAuthenticated: LOCAL_AUTH_MODE,
    serverUnavailable: false,
  }
  _listeners = new Set()
}

// -- Session management -----------------------------------------------------

export async function refreshSession() {
  const { response, data } = await apiFetch('/auth/me/')
  // No answer, or nginx saying the backend is down.
  const serverUnavailable = response.status === 0 || response.status >= 500
  if (serverUnavailable !== _state.serverUnavailable) setState({ serverUnavailable })
  if (response.ok) {
    applySession(data)
    return
  }
  if (response.status === 401) {
    clearState()
  }
}

// -- Google -----------------------------------------------------------------

// A Google sign-in that creates an account needs an invite code. The sign-up
// page sets this to read its invite code field; elsewhere no code is sent.
let readInviteCodeForGoogle = () => ''

export function setInviteCodeReaderForGoogle(reader) {
  readInviteCodeForGoogle = reader
}

export async function handleGoogleCredential(credentialResponse) {
  try {
    if (!credentialResponse?.credential) {
      setState({ authError: 'Missing Google credential' })
      return
    }
    setState({ authError: '' })
    const { response, data } = await apiFetch('/auth/google/', {
      method: 'POST',
      body: { id_token: credentialResponse.credential, invite_code: readInviteCodeForGoogle() },
    })
    if (data.code === 'invite_required') {
      setState({ authError: 'No account uses this Google address yet. To create one, enter your invite code on the sign-up page, then continue with Google.' })
      return
    }
    if (!response.ok) {
      setState({ authError: data.error || 'Google sign-in failed' })
      return
    }
    applySession(data)
  } catch (err) {
    console.error('Google sign-in error:', err)
    setState({ authError: 'Sign-in failed unexpectedly' })
  }
}

// -- Email / password actions -----------------------------------------------

export async function signupWithEmail(email, password, inviteCode) {
  // Signup returns 202 with a generic body, or 400 for a bad password or
  // invite code; the session cookie (if any) is what signals success. Fetch
  // /auth/me/ to discover the real state: signed-in (existing verified
  // account, correct password) vs pending-verify (new account or unverified
  // collision).
  const { response, data } = await apiFetch('/auth/signup/', {
    method: 'POST',
    body: { email, password, invite_code: inviteCode },
  })
  if (response.ok || response.status === 202) {
    await refreshSession()
    const pendingVerification = !_state.isAuthenticated || !_state.emailVerified
    return { ok: true, pendingVerification }
  }
  return { ok: false, error: data.error || 'Sign up failed.' }
}

export async function loginWithPassword(email, password) {
  const { response, data } = await apiFetch('/auth/login/', {
    method: 'POST',
    body: { email, password },
  })
  if (response.ok) {
    applySession(data)
    return { ok: true }
  }
  return { ok: false, error: data.error || 'Sign in failed.' }
}

export async function logout() {
  try {
    await apiFetch('/auth/logout/', { method: 'POST' })
  } catch {
    // Local auth state still needs to clear if the network request fails.
  }
  clearState()
  try {
    window.google?.accounts?.id?.disableAutoSelect?.()
  } catch {
    // Google SDK cleanup is optional and may be unavailable in tests.
  }
}

export async function requestPasswordReset(email) {
  const { response, data } = await apiFetch('/auth/password-reset/request/', {
    method: 'POST',
    body: { email },
  })
  if (response.ok || response.status === 202) return { ok: true }
  return { ok: false, error: data.error || 'Unable to send reset email right now.' }
}

export async function confirmPasswordReset(token, newPassword) {
  const { response, data } = await apiFetch('/auth/password-reset/confirm/', {
    method: 'POST',
    body: { token, new_password: newPassword },
  })
  if (response.ok) {
    applySession(data)
    return { ok: true }
  }
  return { ok: false, error: data.error || 'Unable to reset password.' }
}

export async function verifyEmail(token) {
  const { response, data } = await apiFetch('/auth/verify-email/', {
    method: 'POST',
    body: { token },
  })
  if (response.ok) {
    await refreshSession()
    return { ok: true }
  }
  return { ok: false, error: data.error || 'Unable to verify email.' }
}

export async function resendVerification() {
  const { response, data } = await apiFetch('/auth/resend-verification/', {
    method: 'POST',
  })
  if (response.ok) return { ok: true }
  return { ok: false, error: data.error || 'Unable to resend email.' }
}
