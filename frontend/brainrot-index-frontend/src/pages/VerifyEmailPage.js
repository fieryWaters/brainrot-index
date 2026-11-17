import { getState, verifyEmail } from '../lib/auth.js'

export function mountVerifyEmailPage() {
  const container = document.createElement('div')
  container.className = 'max-w-md mx-auto px-4 py-12'

  const card = document.createElement('div')
  card.className = 'rounded-2xl border border-white/10 bg-black/30 p-8 text-center'

  const heading = document.createElement('h1')
  heading.className = 'text-2xl font-bold mb-2 text-white'
  heading.textContent = 'Verifying your email...'
  card.appendChild(heading)

  const body = document.createElement('p')
  body.className = 'text-sm text-white/60 mb-6'
  body.textContent = 'Hang tight.'
  card.appendChild(body)

  const homeLink = document.createElement('a')
  homeLink.href = '/'
  homeLink.className =
    'inline-block px-5 py-2.5 rounded-xl font-semibold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black transition-all'
  homeLink.textContent = 'Go home'
  homeLink.style.display = 'none'
  card.appendChild(homeLink)

  container.appendChild(card)

  const params = new URLSearchParams(window.location.search)
  const token = params.get('token') || ''

  if (!token) {
    heading.textContent = 'Missing token'
    body.textContent = 'This verification link looks incomplete.'
    homeLink.style.display = ''
  } else {
    verifyEmail(token).then((result) => {
      if (result.ok) {
        heading.textContent = 'Email verified'
        body.textContent = 'Thanks! Your email is all set. Next, install the extension and connect it.'
        if (getState().isAuthenticated) {
          homeLink.href = '/dashboard'
          homeLink.textContent = 'Continue setup'
        } else {
          homeLink.href = '/login'
          homeLink.textContent = 'Sign in to continue'
        }
      } else {
        heading.textContent = 'Link invalid'
        body.textContent = result.error || 'This verification link has expired or been used.'
      }
      homeLink.style.display = ''
    })
  }

  return { el: container }
}
