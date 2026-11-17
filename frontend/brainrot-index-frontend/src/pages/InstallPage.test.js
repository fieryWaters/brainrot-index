import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen } from '@testing-library/dom'
import { renderElement } from '../test-utils.js'

// site.js reads the Web Store address when it is first imported, so each test
// sets the build value and imports the page afresh.
async function renderInstallPage(webstoreUrl) {
  vi.stubEnv('VITE_WEBSTORE_URL', webstoreUrl)
  vi.resetModules()
  const { mountInstallPage } = await import('./InstallPage.js')
  return renderElement(mountInstallPage().el)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllEnvs()
})

describe('InstallPage', () => {
  it('walks through Load unpacked from the downloaded zip until the Web Store listing exists', async () => {
    await renderInstallPage('')

    const download = screen.getByText('Download the extension')
    expect(download.getAttribute('href')).toBe('/downloads/brainrot-index-extension.zip')
    expect(download.hasAttribute('download')).toBe(true)
    expect(screen.getByText('A one-click install is coming')).toBeInTheDocument()
    expect(screen.getByText('Turn on Developer mode')).toBeInTheDocument()
    expect(screen.getByText('Load the folder')).toBeInTheDocument()
    expect(screen.queryByText('Add to Brave or Chrome')).not.toBeInTheDocument()
  })

  it('names the extensions page of the chosen browser', async () => {
    await renderInstallPage('')

    screen.getByRole('tab', { name: 'Brave' }).click()
    expect(screen.getByText('brave://extensions')).toBeInTheDocument()
    screen.getByRole('tab', { name: 'Chrome' }).click()
    expect(screen.getByText('chrome://extensions')).toBeInTheDocument()
  })

  it('shows one store button once the Web Store address is set', async () => {
    await renderInstallPage('https://chromewebstore.google.com/detail/brainrot-index/abc')

    const storeLink = screen.getByText('Add to Brave or Chrome')
    expect(storeLink.getAttribute('href')).toBe('https://chromewebstore.google.com/detail/brainrot-index/abc')
    expect(screen.queryByText('Download the extension')).not.toBeInTheDocument()
    expect(screen.queryByText('Turn on Developer mode')).not.toBeInTheDocument()
  })

  it('says so when the extension is already installed', async () => {
    await renderInstallPage('')
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'brainrot-index-extension-present' },
      origin: window.location.origin,
    }))
    expect(screen.getByText('The extension is already installed in this browser.')).toBeInTheDocument()
  })
})
