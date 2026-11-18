// DRAFT, NOT YET REVIEWED. This Privacy Policy was written by an engineer to
// match what the code does on 2026-11-17. The owner, and ideally a lawyer,
// must review it before relying on it. Points to check in particular: the legal
// entity behind "we", the governing law, where the servers are, how long
// server logs are kept, the age rules for children's accounts (COPPA in the
// US, GDPR-K in the EU), and whether the cases where a person reads stored
// posts fit the Chrome Web Store's Limited Use policy. Keep it true: when the code changes
// what is collected, sent or kept, change this text in the same commit.

import { mountLegalPage } from './LegalPage.js'

export const PRIVACY_EFFECTIVE_DATE = 'November 17, 2026'

const PRIVACY_HTML = `
<p>BrainRot Index is a browser extension and website that filters the posts in your social media feeds. This policy explains what we
collect, why, and your choices.</p>

<h2>What we collect</h2>
<ul>
  <li><strong>Posts you see.</strong> Once you agree on the extension's consent screen, and while it is on and connected, the extension
  sends us the posts you see on supported sites (text, images, video, and who posted them).</li>
  <li><strong>Your account.</strong> Your email address, your name if you sign in with Google, your settings, your consent choices, and
  the reports and feedback you send.</li>
  <li><strong>Feedback when not signed in.</strong> What you send with the Feedback button, and an email address if you give one for a reply.</li>
  <li><strong>Payments.</strong> Payments are handled by our payment provider.</li>
  <li><strong>Technical data.</strong> IP addresses, cookies and similar records used to sign you in and keep accounts secure.</li>
</ul>

<h2>Why we use it</h2>
<p>To classify posts, to improve our service, to detect fraud and abuse, and to run your account and subscription.</p>

<h2>Who we share it with</h2>
<p>Service providers that help us run the service, including AI providers that help us classify posts, and payment, email and
hosting providers. We may also disclose information when the law requires it. We don't sell your data.</p>

<h2>Chrome Web Store Limited Use</h2>
<p>BrainRot Index's use of information received from the browser extension adheres to the
<a href="https://developer.chrome.com/docs/webstore/program-policies/policies">Chrome Web Store User Data Policy</a>, including the
Limited Use requirements.</p>

<h2>Your choices</h2>
<ul>
  <li>The extension sends nothing until you agree on its consent screen.</li>
  <li>You can switch filtering off at any time, or press "Disconnect" in the extension's toolbar button to withdraw your agreement.</li>
  <li>You can download your data or delete your account on the Account page.</li>
  <li>Children under 13 may not create their own account.</li>
</ul>

<h2>Contact</h2>
<p>For questions and requests, use the Feedback button on any page.</p>
`

export function mountPrivacyPage() {
  return mountLegalPage({ title: 'Privacy Policy', effectiveDate: PRIVACY_EFFECTIVE_DATE, bodyHtml: PRIVACY_HTML })
}
