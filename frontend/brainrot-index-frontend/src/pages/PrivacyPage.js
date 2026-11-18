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
<p>BrainRot Index is a browser extension and website that filters the posts in your social media feeds. This page explains what we
collect, why, and what you can do about it.</p>

<h2>What we collect</h2>
<ul>
  <li><strong>What the extension checks.</strong> Once you agree on its consent screen, and while it is switched on and connected, the
  extension sends us the posts and videos you see on supported sites: their text, links, images, video, and who posted them. If you use a
  video filter, our server downloads the first seconds of a Reddit or X video from that site's video host, and a YouTube video is
  watched by Google's Gemini model from its link. We keep these posts and videos together with the account that sent them, along with what the filters
  decided.</li>
  <li><strong>Your agreement.</strong> When you agreed on the extension's consent screen, and when you withdrew it by disconnecting.</li>
  <li><strong>Your account.</strong> Your email address, your name if you sign in with Google, your settings, and the reports and feedback you send.</li>
  <li><strong>Payments.</strong> Stripe handles payments. We never see your card number.</li>
  <li><strong>Technical data.</strong> IP addresses and similar records our servers keep to sign you in and protect accounts.</li>
</ul>
<p>The extension does not read your messages, what you type, or sites it does not support.</p>

<h2>Why we use it</h2>
<p>To classify posts with your filters, to improve our service (for example, to make the filters more accurate), to detect fraud and
abuse, and to run your account and subscription.</p>

<h2>When a person reads your posts</h2>
<p>Most of the work is automated. A person on our side looks at individual posts only when you report one, to investigate abuse or a
security problem, or when the law requires it.</p>

<h2>Who gets it</h2>
<p>Service providers that help us run and improve the service: the AI model providers that read posts to classify them (OpenRouter,
and Google through its Gemini API), payment and email providers, and hosting. They get only what they need for that work. We may also
disclose information when the law requires it. <strong>We don't sell your data, and we don't use it for advertising.</strong></p>

<h2>Chrome Web Store Limited Use</h2>
<p>BrainRot Index's use of information received from the browser extension adheres to the
<a href="https://developer.chrome.com/docs/webstore/program-policies/policies">Chrome Web Store User Data Policy</a>, including its
Limited Use requirements. We use that information only to provide and improve the extension's filtering and to keep the service safe;
we do not transfer it except as this policy describes, and we do not use it for advertising or to determine creditworthiness.</p>

<h2>Your choices</h2>
<ul>
  <li>The extension sends nothing until you agree on its consent screen. If you choose "Not now", it does nothing.</li>
  <li>Switch filtering off at any time and the extension stops sending posts. "Disconnect" in the extension's toolbar button withdraws
  your agreement and makes the extension forget your account.</li>
  <li>Download your data, or delete your account and the data tied to it, on the Account page. Posts and their results stay in a shared
  cache without the link to you, because other people's feeds show them too.</li>
  <li>The site uses only the cookies it needs to keep you signed in and secure.</li>
  <li>Children under 13 may not create their own account; a parent can use child mode on their child's browser.</li>
</ul>
<p>If we change this policy in a way that matters, we will tell you before it takes effect.</p>

<h2>Contact</h2>
<p>Questions and requests: <a href="mailto:support@brainrotindex.com">support@brainrotindex.com</a>.</p>
`

export function mountPrivacyPage() {
  return mountLegalPage({ title: 'Privacy Policy', effectiveDate: PRIVACY_EFFECTIVE_DATE, bodyHtml: PRIVACY_HTML })
}
