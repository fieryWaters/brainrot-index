// Publishing a plugin: its name, description, author name, starting
// threshold and rubric, with a box to try the rubric before publishing.

import { apiFetch, errorMessageFrom } from '../lib/api.js'
import { el } from '../lib/dom.js'
import { navigate } from '../lib/router.js'
import { createErrorBanner } from '../components/ErrorBanner.js'
import { thresholdDescription } from '../components/FilterSettings.js'
import { createTryRubricBox } from '../components/TryRubricBox.js'
import { CARD_CLASS, INPUT_CLASS, LABEL_CLASS, PRIMARY_BUTTON_CLASS } from '../components/styles.js'

export const MAX_RUBRIC_CHARACTERS = 4000

export const RUBRIC_HELP = 'Describe what to look for: what the content is, the signals that show it, and what does not count. A fixed frame around your rubric asks the model for a score from 0 to 100, so a plugin can only score posts.'

// A labeled text input or text area, with an optional character counter.
export function createField(label, { multiline = false, maxLength, placeholder = '', counter = false } = {}) {
  const input = el(multiline ? 'textarea' : 'input', INPUT_CLASS + (multiline ? ' h-64 font-mono text-xs' : ''))
  input.maxLength = maxLength
  input.placeholder = placeholder
  input.setAttribute('aria-label', label)
  const count = el('span', 'text-xs text-white/40')
  if (counter) {
    const update = () => { count.textContent = `${input.value.length} / ${maxLength}` }
    input.addEventListener('input', update)
    update()
  }
  const wrapper = el('div', 'flex flex-col gap-1.5',
    el('div', 'flex items-center justify-between', el('label', LABEL_CLASS, label), count),
    input)
  return { wrapper, input }
}

export function mountPublishPluginPage() {
  let errorSlot = el('div')
  function showError(message) {
    const next = createErrorBanner(message)
    errorSlot.replaceWith(next)
    errorSlot = next
  }

  const name = createField('Name', { maxLength: 60, placeholder: 'Crypto hype' })
  const description = createField('Description', { maxLength: 300, placeholder: 'One sentence on what this plugin filters.', counter: true })
  const authorName = createField('Author name shown in the store', { maxLength: 60, placeholder: 'Your name or a nickname' })
  const rubric = createField('Rubric', { multiline: true, maxLength: MAX_RUBRIC_CHARACTERS, counter: true,
    placeholder: 'Flag posts that ...\n\nSignals:\n- ...\n\nDo not flag:\n- ...' })

  const thresholdLabel = el('span', 'text-sm text-white/70', thresholdDescription(60))
  const thresholdSlider = el('input', 'w-full accent-amber-500')
  thresholdSlider.type = 'range'
  thresholdSlider.min = '0'
  thresholdSlider.max = '100'
  thresholdSlider.value = '60'
  thresholdSlider.setAttribute('aria-label', 'Starting threshold')
  thresholdSlider.addEventListener('input', () => {
    thresholdLabel.textContent = thresholdDescription(thresholdSlider.value)
  })

  const publishButton = el('button', PRIMARY_BUTTON_CLASS, 'Publish')
  publishButton.type = 'button'
  publishButton.addEventListener('click', async () => {
    publishButton.disabled = true
    const { response, data } = await apiFetch('/store/plugins/', {
      method: 'POST',
      body: {
        name: name.input.value.trim(),
        description: description.input.value.trim(),
        author_name: authorName.input.value.trim(),
        rubric: rubric.input.value,
        default_threshold: Number(thresholdSlider.value),
      },
    })
    publishButton.disabled = false
    if (!response.ok) {
      showError(errorMessageFrom(data, 'Could not publish the plugin. Please try again.'))
      window.scrollTo(0, 0)
      return
    }
    navigate(`/store/${data.slug}`)
  })

  const storeLink = el('a', 'text-sm text-amber-400 hover:text-amber-300', 'Back to the store')
  storeLink.href = '/store'

  const container = el('div', 'max-w-2xl mx-auto px-4 py-12',
    storeLink,
    el('h1', 'text-3xl font-bold mt-2 mb-2 text-white', 'Publish a plugin'),
    el('p', 'text-white/60 mb-8', 'Anyone can install it from the store. Later rubric changes are published as new versions.'),
    errorSlot,
    el('div', CARD_CLASS + ' flex flex-col gap-5',
      name.wrapper,
      description.wrapper,
      authorName.wrapper,
      el('div', 'flex flex-col gap-1.5',
        el('label', LABEL_CLASS, 'Starting threshold'),
        thresholdLabel,
        thresholdSlider,
        el('p', 'text-xs text-white/40', 'Where the slider starts for people who install it. They can move it.')),
      el('div', 'flex flex-col gap-2',
        rubric.wrapper,
        el('p', 'text-xs text-white/40', RUBRIC_HELP)),
      createTryRubricBox(() => rubric.input.value),
      el('div', 'flex justify-end', publishButton)))

  return { el: container }
}
