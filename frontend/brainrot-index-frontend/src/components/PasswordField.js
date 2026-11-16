// Password input with a show/hide toggle. Returns the input element and a
// getter for the current value so callers can treat it like a normal field.

export function createPasswordField({ id, placeholder = 'Password', autocomplete = 'current-password' } = {}) {
  const wrapper = document.createElement('div')
  wrapper.className = 'relative'

  const input = document.createElement('input')
  input.type = 'password'
  input.id = id || ''
  input.placeholder = placeholder
  input.autocomplete = autocomplete
  input.className =
    'w-full px-4 py-3 pr-12 rounded-xl bg-black/30 border border-white/10 text-white placeholder-white/30 focus:border-amber-500 focus:outline-none transition-colors'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className =
    'absolute inset-y-0 right-0 px-3 text-xs text-white/50 hover:text-white/80 focus:outline-none'
  toggle.textContent = 'Show'
  toggle.setAttribute('aria-label', 'Toggle password visibility')
  toggle.addEventListener('click', () => {
    const revealed = input.type === 'text'
    input.type = revealed ? 'password' : 'text'
    toggle.textContent = revealed ? 'Show' : 'Hide'
    input.focus()
  })

  wrapper.appendChild(input)
  wrapper.appendChild(toggle)

  return { el: wrapper, input, getValue: () => input.value }
}
