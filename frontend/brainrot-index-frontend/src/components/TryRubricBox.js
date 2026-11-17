// "Try it": scores pasted post text with a draft rubric, exactly as a
// published version would, before the author publishes it. Each try is one
// model call, so the server limits how often it can be used.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { ACCENT_BUTTON_CLASS, INPUT_CLASS, LABEL_CLASS, SELECT_CLASS } from './styles.js'

export function createTryRubricBox(getRubric) {
  const textBox = el('textarea', INPUT_CLASS + ' h-28')
  textBox.placeholder = 'Paste the text of a post'
  textBox.maxLength = 4000
  textBox.setAttribute('aria-label', 'Post text to try')

  const platformSelect = el('select', SELECT_CLASS)
  for (const [value, label] of [['reddit', 'Reddit'], ['x', 'X']]) {
    const option = el('option', '', label)
    option.value = value
    platformSelect.appendChild(option)
  }
  platformSelect.setAttribute('aria-label', 'Platform of the post')

  const result = el('div', 'text-sm')
  result.setAttribute('role', 'status')
  const tryButton = el('button', ACCENT_BUTTON_CLASS, 'Try it')
  tryButton.type = 'button'
  tryButton.addEventListener('click', async () => {
    const text = textBox.value.trim()
    if (!text) {
      result.replaceChildren(el('p', 'text-red-400', 'Paste the text of a post to try.'))
      return
    }
    tryButton.disabled = true
    result.replaceChildren(el('p', 'text-white/50', 'Asking the model...'))
    const { response, data } = await apiFetch('/store/try/', {
      method: 'POST',
      body: { rubric: getRubric(), text, platform: platformSelect.value },
    })
    tryButton.disabled = false
    if (!response.ok) {
      const fallback = response.status === 429
        ? 'You have used every try for this hour. Please try again later.'
        : 'Could not try the rubric. Please try again.'
      result.replaceChildren(el('p', 'text-red-400', response.status === 429 ? fallback : errorMessageFrom(data, fallback)))
      return
    }
    result.replaceChildren(
      el('p', 'text-white', `Score ${data.score} out of 100, labeled ${data.label}`),
      el('p', 'text-white/60 mt-1', data.reasoning))
  })

  return el('div', 'rounded-xl border border-white/10 bg-black/20 p-4 flex flex-col gap-3',
    el('div', '',
      el('p', LABEL_CLASS, 'Try it'),
      el('p', 'text-xs text-white/40 mt-1', 'Runs the rubric above on one post, the same way it will run in feeds. Limited to 20 tries an hour.')),
    textBox,
    el('div', 'flex items-center justify-between gap-3', platformSelect, tryButton),
    result)
}
