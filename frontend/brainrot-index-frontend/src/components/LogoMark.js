// The brand mark: the glowing shield, drawn from brand/logo-source.webp by extension-tests/make-icons.mjs.
// It always sits beside or above the name, so it carries no text of its own for screen readers.

import { el } from '../lib/dom.js'

export function createLogoMark(className) {
  const mark = el('img', className)
  mark.src = '/logo-mark.webp'
  mark.alt = ''
  return mark
}
