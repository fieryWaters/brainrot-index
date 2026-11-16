// el('p', 'text-sm', 'hello') - build a DOM element in one expression.
// Children are strings (become text nodes) or elements; nest calls to mirror
// the markup being produced. Anything beyond tag/class/children (listeners,
// attributes, refs) is set on the returned element as usual.
export function el(tag, className, ...children) {
  const element = document.createElement(tag)
  if (className) element.className = className
  element.append(...children)
  return element
}
