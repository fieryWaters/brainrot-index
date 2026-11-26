// Facts about the site that several pages state.

// The extension's Chrome Web Store listing, set at build time (WEBSTORE_URL in
// .env). Empty until the listing is live; the install page then explains Load unpacked.
export const WEBSTORE_URL = import.meta.env.VITE_WEBSTORE_URL || ''

// The newest packed extension, built into the site image.
export const EXTENSION_ZIP_URL = '/downloads/brainrot-index-extension.zip'

export const PRICE_PER_MONTH = '$4.99'
export const TRIAL_DAYS = 7
