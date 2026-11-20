// DRAFT, NOT YET REVIEWED. These Terms of Service were written by an engineer
// to match how the product works on 2026-11-16. The owner, and ideally a
// lawyer, must review them before relying on them. Points to check in
// particular: the legal entity behind "we", the governing law and courts
// (deliberately left out until the owner decides), consumer-law limits on the
// disclaimers and the liability cap where customers live, the refund policy,
// and the minimum age.

import { mountLegalPage } from './LegalPage.js'

export const TERMS_EFFECTIVE_DATE = 'November 16, 2026'

const TERMS_HTML = `
<p>These terms are the agreement between you and BrainRot Index ("we", "us") for using the BrainRot Index website at
brainrotindex.com and the BrainRot Index browser extension (together, "the service"). By creating an account or using the
extension you agree to them. Our <a href="/privacy">Privacy Policy</a> explains what data the service collects and how it is used.</p>

<h2>1. What the service does</h2>
<p>The extension reads the posts in your feeds on supported sites, sends them to our servers, and hides the ones that the
filters you turned on flag. AI models read each post and score it.</p>
<p>AI models make mistakes. The service will sometimes hide a post you wanted to see and show a post you did not. We do not promise
that any particular post will be caught or left alone. BrainRot Index is not affiliated with any site it works on, and changes those
sites make can stop the extension from working until we update it.</p>

<h2>2. Your account</h2>
<ul>
  <li>You must be at least 13 years old to create an account. If you are under 18, you need a parent's or guardian's permission.</li>
  <li>Give a real email address you can read, and keep your password to yourself. You are responsible for what happens under your account.</li>
  <li>One account is for one person. A parent or guardian may use their account, in child mode, on a browser their child uses;
  they are responsible for that use.</li>
  <li>Tell us with the Feedback button if you think someone else is using your account.</li>
</ul>

<h2>3. Free trial, subscription and cancellation</h2>
<ul>
  <li>A new account gets a free trial of 7 days. No payment card is needed to start it. When the trial ends, filtering stops until you subscribe.</li>
  <li>The subscription costs $5 per month (plus any tax that applies), charged in advance each month by our payment processor, Stripe,
  until you cancel. If you subscribe during your trial, the first charge comes when the trial would have ended.</li>
  <li>You can cancel at any time from your dashboard (Manage subscription). Filtering keeps working until the end of the month you have paid
  for, and you are not charged again. We do not refund partial months, except where the law requires it.</li>
  <li>If a payment fails, we keep the service running while Stripe retries the card; if it keeps failing, the subscription ends.</li>
  <li>If we change the price, we will tell you by email at least 30 days before it applies to you, and you can cancel before then.</li>
</ul>

<h2>4. Fair use</h2>
<p>You agree not to:</p>
<ul>
  <li>use the service to break the law or the rules of the sites it works on;</li>
  <li>send the service content that you collected outside normal browsing, or use it as a bulk classification service for other software;</li>
  <li>try to get around the daily limit on new posts, the free trial, or payment;</li>
  <li>interfere with the service, probe it for weaknesses without our permission, or access other people's accounts;</li>
  <li>copy, resell or rebrand the service.</li>
</ul>
<p>Each account may send a limited number of new posts for classification per day. Past the limit, posts are shown unfiltered until the next day.</p>

<h2>5. Filters published by users</h2>
<p>Anyone with an account may write and publish a filter for others to install. If you publish a filter, you are responsible for it, you
confirm you have the right to publish it, and you let us and other users use, run and display it as part of the service, for as long as it is
published and afterward for people who already installed it. We may remove any filter at any time. A published filter only scores posts;
it cannot do anything else in your browser. Children's accounts cannot install filters.</p>

<h2>6. Your feedback</h2>
<p>When you send us a report or feedback, you let us use it to improve the service without owing you anything for it.</p>

<h2>7. Ending the service</h2>
<p>You can stop using the service and delete your account at any time from the Account page. We may suspend or close an account that
breaks these terms, after telling you why when we can. We may change or stop parts of the service; if we shut the whole service down,
we will tell you at least 30 days ahead and stop charging you.</p>

<h2>8. Disclaimers</h2>
<p>The service is provided "as is" and "as available". As far as the law allows, we make no promises about it beyond those written in these
terms, including any implied promise that it is fit for a particular purpose, always available, or free of errors. Child mode is a content
filter, not a parental control system, and is not a substitute for supervising a child online.</p>

<h2>9. Limit of liability</h2>
<p>As far as the law allows, we are not liable for indirect or consequential losses, or for posts the service showed, hid or failed to hide.
Our total liability to you for any claim about the service is limited to the amount you paid us in the 12 months before the claim.
Nothing in these terms limits liability that the law does not allow to be limited, or takes away rights you have as a consumer.</p>

<h2>10. Changes to these terms</h2>
<p>We may update these terms. We will change the date at the top of this page, and tell you by email or on the site before important
changes take effect. If you keep using the service after that, the new terms apply; if you do not agree, you can cancel and delete your account.</p>

<h2>11. Contact</h2>
<p>For questions about these terms, use the Feedback button on any page.</p>
`

export function mountTermsPage() {
  return mountLegalPage({ title: 'Terms of Service', effectiveDate: TERMS_EFFECTIVE_DATE, bodyHtml: TERMS_HTML })
}
