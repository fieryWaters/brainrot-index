// Test helper: appends a vanilla JS element to a container div attached to document.body.
// Returns the container so tests can query within it.

export function renderElement(el) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  container.appendChild(el)
  return container
}
