// DRAFT, NOT YET REVIEWED. This Privacy Policy was written by an engineer to
// match what the code does on 2026-11-16. The owner, and ideally a lawyer,
// must review it before relying on it. Points to check in particular: the legal
// entity behind "we", the governing law, where the servers are, how long
// server logs are kept, the age rules for children's accounts (COPPA in the
// US, GDPR-K in the EU), and whether staff reading stored posts fits the
// Chrome Web Store's Limited Use policy. Keep it true: when the code changes
// what is collected, sent or kept, change this text in the same commit.

import { mountLegalPage } from './LegalPage.js'

export const PRIVACY_EFFECTIVE_DATE = 'November 16, 2026'

const PRIVACY_HTML = `
<p>Brainrot Index is a browser extension and website that hides posts you do not want to see on social media sites.
To decide which posts to hide, the extension sends the posts in your feed to our servers, where AI models read them.
This policy explains exactly what we collect, why, who else receives it, how long we keep it, and what you can do about it.
We wrote it to be read, not skimmed past. If anything here is unclear, write to
<a href="mailto:support@brainrotindex.com">support@brainrotindex.com</a>.</p>

<p><strong>The short version:</strong> the extension sends us every post it sees while it is on, and we keep those posts.
Stored posts are not linked to your account. We do not sell your data and we do not show ads.</p>

<h2>1. What the extension sends us</h2>
<p>While the extension is connected to your account and filtering is switched on, it sends us each post and reply it finds on the
pages of supported sites (currently X and Reddit) as you browse them. For each post it sends:</p>
<ul>
  <li>the text of the post or reply</li>
  <li>the author's username (for example @someone or u/someone)</li>
  <li>the post's address (URL) and its ID on that site, and the ID of the post it replies to</li>
  <li>the community it was posted in, such as a subreddit</li>
  <li>the addresses of the images in the post</li>
</ul>
<p>When you report a mistake with the extension's <strong>Wrong?</strong> link, its right-click menu, or its feedback box,
it also sends what you wrote, the address of the page you were on, and the version of the extension.</p>
<p>The extension does not send your browsing history, the pages you visit on other sites, your private messages, or anything
you type into X or Reddit. It sends nothing while it is switched off, while it is not connected to an account, or on sites it does not support.</p>
<p>In your browser, the extension keeps its connection key, the server address and its on/off switch. It also remembers the
answers it got for posts during the current browser session, which your browser clears when it closes.</p>

<h2>2. What we keep on our servers</h2>
<h3>Posts and their classifications</h3>
<p>We store every post the extension sends, the first time any user's extension sends it: the text, author username, address, community,
image addresses and the time we first saw it. We also download and store the images themselves. For each filter that reads a post,
we store its result: a score, a label, the model's written reasoning, the exact prompt sent to the model, the model's raw answer and
which model gave it.</p>
<p>These stored posts are a <strong>shared cache</strong>: when several people see the same post, it is stored and classified once,
and everyone gets the same stored result. Stored posts and classifications <strong>do not record which account sent them or who saw them</strong>.
They stay when you delete your account, because they cannot be traced back to you.</p>
<p>Keep in mind that a stored post can contain personal information about its author, and can be your own post if the extension
saw it in your feed.</p>
<h3>Your account</h3>
<ul>
  <li>your email address, whether you have verified it, and how you sign in (password, Google or both)</li>
  <li>your password, stored only as a salted hash that cannot be turned back into the password</li>
  <li>if you sign in with Google: your first and last name as Google gives them to us</li>
  <li>your settings: filtering on or off, adult or child mode, and for each filter whether it is on, how strict it is, and whether it blurs or hides</li>
  <li>your extension connections: when each was made and last used (only a hash of each connection key is kept)</li>
  <li>how many new posts your account sent for classification each day, to enforce the daily limit</li>
  <li>your subscription: trial dates, status and renewal date, and the ID of your customer record at Stripe</li>
  <li>the reports and feedback you send us, with the page address and the versions of the site and extension you were using</li>
</ul>
<h3>Server logs</h3>
<p>Our servers record IP addresses for sign-ins, sign-ups and password resets, and use them to limit how many requests one address
can make, to protect accounts against abuse.</p>

<h2>3. Why we use it</h2>
<ul>
  <li><strong>To run the service:</strong> to classify posts, apply your settings, and tell the extension what to blur or hide.</li>
  <li><strong>To make filtering faster and cheaper:</strong> the shared cache means a post is read by a model once, not once per person.</li>
  <li><strong>To make filtering better:</strong> we use stored posts, classifications and your reports to measure how accurate the filters
  are, to fix mistakes and to improve the filters' instructions. People at Brainrot Index may read stored posts, classifications and the
  reports you send in order to do this.</li>
  <li><strong>To run your account:</strong> to sign you in, send you verification and password reset emails, and manage your trial and subscription.</li>
  <li><strong>To protect the service:</strong> to limit abuse and investigate security problems.</li>
</ul>
<p>We do not sell your data, rent it, or share it with advertisers or data brokers, and we do not use it to show you ads.</p>

<h2>4. Who else receives it</h2>
<p>We share data only with the companies that help us run Brainrot Index, and only what each needs:</p>
<ul>
  <li><strong>AI model providers.</strong> To classify a post we send its text, community, the text of the post it replies to, and its images
  to an AI model. We reach models through <strong>OpenRouter</strong>, which passes the request to the company that runs the model;
  today that is <strong>Google</strong> (Gemini models). These providers receive post content only, never your email address or account details.
  Some posts are instead classified by a model running on our own server.</li>
  <li><strong>Stripe</strong> processes payments. When you subscribe, Stripe receives your email address and the payment details you
  enter on Stripe's own checkout page. We never see or store your card number. Stripe keeps its own records of payments.</li>
  <li><strong>Google</strong>, if you choose to sign in with Google: Google tells us your email address and name. The Google sign-in button
  is loaded from Google, which may set its own cookies.</li>
  <li><strong>Resend</strong> delivers the emails we send you, so it receives your email address and the email's contents.</li>
  <li><strong>Cloudflare</strong> carries traffic between your browser and our servers.</li>
</ul>
<p>We may also disclose information if the law requires it, or to protect the safety of people or the service. If Brainrot Index is ever
sold or merged, your data would move to the new owner under this policy, and we would tell you first.</p>

<h2>5. How long we keep it</h2>
<ul>
  <li><strong>Stored posts, images and classifications</strong> are kept indefinitely, because they serve as the shared cache and as the
  record we use to measure and improve the filters.</li>
  <li><strong>Your account data</strong> is kept until you delete your account.</li>
  <li><strong>Your reports and feedback</strong> are kept until you delete your account.</li>
</ul>

<h2>6. Your choices and rights</h2>
<ul>
  <li><strong>Pause:</strong> switch filtering off in the extension's toolbar button or on your dashboard, and the extension stops sending posts.</li>
  <li><strong>Download your data:</strong> on the Account page, <strong>Download my data</strong> gives you a JSON file of your account,
  subscription, settings, filters and reports.</li>
  <li><strong>Delete your account:</strong> on the Account page. This removes your account and everything listed under "Your account" above,
  disconnects every extension and cancels your subscription. Stored posts and classifications stay, as explained above.</li>
  <li><strong>Correct your data:</strong> change your settings on the dashboard and your password on the Account page.
  For anything else, write to us.</li>
  <li><strong>Remove a post:</strong> if you wrote a post that we stored and want it removed from our cache, write to us with its address.</li>
</ul>
<p>Depending on where you live, you may have further rights over your personal data, such as to object to how we use it or to complain
to your data protection authority. Write to <a href="mailto:support@brainrotindex.com">support@brainrotindex.com</a> and we will answer
within 30 days.</p>

<h2>7. Cookies</h2>
<p>The website uses two cookies of its own, both needed for it to work: one keeps you signed in (for up to two weeks), and one protects
forms against forgery. We use no analytics or advertising cookies. The Google sign-in button and Stripe's checkout page are run by those
companies and follow their own cookie policies.</p>

<h2>8. Children</h2>
<p>Brainrot Index is meant to be set up by adults. Children under 13 may not create their own account, and we do not knowingly
collect information from a child under 13 who signed up on their own; if we learn of one, we delete the account.</p>
<p>A parent or guardian can use <strong>child mode</strong> on a browser their child uses. In child mode, posts stay blurred until they have
been checked and filtered posts cannot be revealed. The account, its settings and its subscription belong to the parent or guardian.
Posts seen in a child's browser are handled exactly like everyone else's: they are sent to us and to the AI model providers, and stored in
the shared cache without being linked to the account. We never use them for advertising and never sell them.</p>
<p>Child mode is a filter, not a lock: a child who can manage the browser's extensions can switch it off or remove it.</p>

<h2>9. Security</h2>
<p>All traffic to and from Brainrot Index is encrypted with HTTPS. Passwords and extension connection keys are stored only as hashes.
No system is perfectly secure; if we learn of a breach that affects your data, we will tell you.</p>

<h2>10. Changes to this policy</h2>
<p>When we change what we collect or how we use it, we will update this page and its date, and for important changes we will tell
you by email or on the site before they take effect.</p>

<h2>11. Contact</h2>
<p>Questions, requests and complaints: <a href="mailto:support@brainrotindex.com">support@brainrotindex.com</a>.</p>
`

export function mountPrivacyPage() {
  return mountLegalPage({ title: 'Privacy Policy', effectiveDate: PRIVACY_EFFECTIVE_DATE, bodyHtml: PRIVACY_HTML })
}
