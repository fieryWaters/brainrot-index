# Chrome Web Store review: how strict in practice

Researched 2026-11-17. Labels: [OFFICIAL] = Google documentation. [DEV] = a developer's own report. [BLOG] = third-party blog or vendor (weak evidence, often SEO).

Limits of this research: the search tool returned no Reddit or Hacker News threads from the last two years on this topic (only a 2020 HN thread on review delays). Developer reports below come from the chromium-extensions Google group, GitHub issues, and dev.to posts. Treat the "how many rejections before suspension" question as unanswered by evidence.

## 1. Policy changed recently (matters for us)

- [OFFICIAL] Chrome blog, announced 2026-07-01, enforced from 2026-08-01: data collection must be necessary for the extension's single purpose; ALL data collection must be prominently disclosed, even when closely tied to the single purpose; developers must tell users when data handling changes after install. https://developer.chrome.com/blog/cws-policy-updates-2026
- This removes the old escape hatch (data collection "closely tied to the listed feature" needed no in-product disclosure). Older blog posts and older forum threads that mention it are out of date. We should assume the in-product disclosure is mandatory.

## 2. Common rejection reasons (with Google's violation IDs)

[OFFICIAL] table: https://developer.chrome.com/docs/webstore/troubleshooting

Relevant to us:
- Purple Nickel: no prominent disclosure/consent before data collection. Fix: disclose and get affirmative consent before collecting.
- Purple Magnesium: collecting web browsing data beyond what a user-facing feature needs.
- Purple Copper: insecure transmission (use HTTPS, no user data in URLs/headers).
- Purple Lithium: missing/broken privacy policy link in dashboard.
- Purple Potassium: excessive permissions. Fix: narrowest permissions; Appeal button available.
- Red Magnesium/Copper/Lithium/Argon: single purpose violation.
- Yellow Magnesium: functionality not working (includes reviewer unable to test).
- Yellow Potassium: minimum functionality not met.
- Yellow Zinc / Yellow Argon: missing/misleading metadata; keyword stuffing.
- Red Nickel/Potassium/Silicon: deceptive behavior (listing does not match functionality).
- Blue Argon: remotely hosted code.

Ranking from sources:
- [BLOG, unsourced] Dec 2025 list calls excessive permissions the #1 rejection reason, then vague/misleading description, missing privacy policy, single purpose. https://www.extensionradar.com/blog/chrome-extension-rejected
- [BLOG] Reviewers cross-check dashboard privacy answers against actual network traffic and the privacy policy; mismatch is a flagged signal, and broad hosts add a third signal. https://www.extensionradar.com/blog/chrome-extension-rejected
- [DEV, Nov 2025] Rejected within 10 minutes for keyword spam (listing named ~8 third-party brands); fixed by describing what it does instead of naming brands; passed on resubmit. Lesson: automated checks fire fast and are cheap to fix. Note our listing will name three big sites; keep brand names minimal and factual. https://dev.to/glenkit/chrome-web-store-rejected-my-extension-in-10-minutes-the-line-that-caused-it-nip
- [DEV] Yellow Magnesium case: automated install test on Linux failed because a keyboard shortcut used a Mac-only modifier; changed and resubmitted. https://github.com/snvishna/tabflow-agent/pull/7
- [DEV] Purple Potassium disputed as false positive (debugger permission). https://groups.google.com/a/chromium.org/g/chromium-extensions/c/GdtnseYh5Ng/m/B3saiLfYAQAJ

Honest caveat: the best "user data" rejection reports are from 2020 and are unresolved in the thread:
- Instagram follower exporter, rejected 3 times for "User Data Privacy" even after adding a consent dialog with privacy policy link and Agree button gating features. Rejection text was generic; support gave only an automated reply; no resolution shown. https://groups.google.com/a/chromium.org/g/chromium-extensions/c/AX-eqEuRzqY/m/2M4bE6kAAwAJ
- Extension with broad hosts rejected ~5 times for "post a privacy policy / modern cryptography" despite policy and HTTPS; other developers reported the same; Google's advocate said the policy looked fine and he would appeal. No resolution shown. https://groups.google.com/a/chromium.org/g/chromium-extensions/c/z2MynrCbXRU/m/bXUmVOT2AgAJ
These show the real pain: rejection notices can be vague, and fixing by guesswork can take several rounds. Social-media extensions that touch other people's content are the type that drew these.

## 3. What Google requires for the consent screen

[OFFICIAL] User data FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq and policies page https://developer.chrome.com/docs/webstore/program-policies/policies

The disclosure must:
- Be inside the extension UI. Store listing text or install page does not count.
- Not live only in the privacy policy or terms (a link may supplement it but not replace it).
- Describe the types of data collected and how they are used.
- Be shown before any collection/transmission.
- Require a specific affirmative action (button or checkbox the user clicks to agree). No collection until then. Decline must leave a working non-collecting state (or the extension simply does nothing).
- Be shown again (new disclosure) if data practices change later.
- Name every party that receives the data (privacy policy plus in-product disclosure together must do this).
Also required: privacy policy linked in the dashboard; a Limited Use statement on the extension's website; HTTPS; no ads use or sale of the data; no human reading of user data except with consent, security, legal, or aggregated/anonymized.

What the official page does not give: a model wording. No official passed/failed text examples exist. The only dev-reported failed example is the 2020 dialog above (privacy link plus Agree button), whose rejection reason was never explained, so do not treat "link plus Agree" as sufficient.

Suggested content for our screen (derived from the rules, not from a verified passing example):
1. Plain statement of what is read: the text (and author name/URL if sent) of posts you see on [three sites], as you scroll.
2. Where it goes: sent to our server at [domain] over HTTPS, run through an AI model (name the third-party LLM provider if one is used) to classify it.
3. Why: only to decide whether to hide or blur the post. Nothing else.
4. What we keep: per-account record of which posts were sent (say for how long). State we do not sell it, use it for ads, or let people read it (except the exceptions above).
5. Link to privacy policy.
6. Two buttons: "I agree" and "No thanks". Nothing is read or sent before the click. Consent stored; re-prompt if practices change.
Avoid: pre-checked boxes, consent buried in onboarding steps, vague wording like "to improve your experience", disclosing less than the dashboard privacy tab says.

## 4. Rejections, resubmissions, suspension

- [OFFICIAL] Resubmission after fixing is allowed. One appeal per violation decision. Serious or repeated violations can suspend the developer account (and related accounts); circumventing enforcement means immediate termination. Google does not publish a count of rejections that triggers suspension. https://developer.chrome.com/docs/webstore/program-policies/policies
- [OFFICIAL] Review "may take longer after a rejection or warning". https://developer.chrome.com/docs/webstore/review-process
- [BLOG] "No limit on resubmissions", "rarely permanent"; appeals 1-2 weeks. https://www.extensionradar.com/blog/chrome-extension-rejected  Unverified.
- [DEV] Suspension threads in the group are mostly about malware or terms violations, with terse denials, and are years old: https://groups.google.com/a/chromium.org/g/chromium-extensions/c/HljKaTs9ax8 . I found no report of an account suspended merely for ordinary policy rejections. Absence of evidence only.
- Practical read: an ordinary rejection (a fixable listing or disclosure issue) is a delay of days, not a mark against the account. The real risks are (a) blind guess-fixing loops with vague notices, and (b) anything that looks deceptive or like evasion (re-uploading the same extension under a new listing or account after a rejection, which Google treats as circumvention). Keep the one developer account; fix and resubmit the same item.
- Do not cancel and resubmit a pending item: Google says it resets queue position. (Cancel review exists since Mar 2025 for fixing a real mistake.) https://groups.google.com/a/chromium.org/g/chromium-extensions/c/VJ6DcpEn51Y/m/yuxvHWdwCAAJ

## 5. Review time

- [OFFICIAL] "Most within a few days, up to a few weeks"; contact support if pending over 3 weeks. Longer for broad host permissions (`*://*/*`, `<all_urls>`), new developers, new extensions, dangerous permissions, large or minified code. https://developer.chrome.com/docs/webstore/review-process
- [OFFICIAL, Apr 2026] Chrome Web Store team acknowledged longer waits due to a surge in new submissions, advised building buffer, removing unused permissions, considering activeTab or optional host permissions, removing remote code, and making sure the rejection-notice email address and privacy policy link work. Developers in that thread reported a ~28-day wait for a bug fix. https://groups.google.com/a/chromium.org/g/chromium-extensions/c/VJ6DcpEn51Y/m/yuxvHWdwCAAJ
- [DEV, Nov 2025] Update pending ~4 days; Google cited "larger than normal backlog". https://groups.google.com/a/chromium.org/g/chromium-extensions/c/dPmDpxvo0m0
- Our case: new developer, new extension, content scripts on three big sites = likely the slow path. Our hosts are three specific origins, not all sites, which is better than `<all_urls>`. Plan for 1 to 3 weeks for the first review and several days per round after a rejection.

## 6. Paid extensions, test accounts, Unlisted

- [OFFICIAL] If basic functionality requires payment, the install-time description must say so; the seller must be identified as the developer. Sensitive info for sales must be handled securely. https://developer.chrome.com/docs/webstore/program-policies/policies
- Test instructions: [OFFICIAL dashboard feature, described via BLOG] Dashboard has a Test instructions tab (username 100 chars, password 100 chars, extra instructions 500 chars, confidential). Google says it is only useful when credentials or a paid account are needed; not required to publish, but if reviewers cannot get past login the likely rejection is Yellow Magnesium or Yellow Potassium. https://extensionlaunch.com/blog/chrome-web-store-test-instructions (vendor blog; verify field limits in dashboard).
- Test account advice [BLOG]: dedicated account, no 2FA or email-code step, paid features pre-unlocked (a subscription or trial that does not expire during review), sample data preloaded, keep it alive for later updates, test the exact packed build in a fresh profile. Our 7-day trial is a risk: a trial can lapse during a multi-week review, so give the reviewer account a permanent comp subscription.
- Reviewers also need the social media sites themselves: provide a test login for each of the three sites, or instructions and a public page where posts show, since content scripts act on those pages. (My inference; no source addresses this.)
- Unlisted: [OFFICIAL via vendor blog quoting docs] all visibility settings go through the same review and policy requirements; a DevRel engineer said minimum functionality does not depend on visibility. So Unlisted gives no leniency, only no search listing. https://extensionlaunch.com/blog/chrome-web-store-test-instructions
- Sending page content to a server: [OFFICIAL] scraping/capturing page content counts as handling user data; web browsing activity may only be collected as required for a user-facing feature described in the listing AND the UI. Our feature (classify posts to hide them) is plainly user-facing, so this is allowed if disclosed and consented, but "necessary for single purpose" now applies: send only what the classifier needs (post text), not full page, URLs, or profile data beyond need.
- Single purpose: keep the one-line purpose as "hide/blur posts matching categories the user chose". Do not bundle unrelated features (analytics dashboards, sharing).

## 7. Sources not retrievable or weak

- No usable Reddit/HN reports found for 2024-2026. Palant's Jan 2025 article argues Google's enforcement is reactive and inconsistent (scammy extensions stay up), i.e. strictness is uneven, not uniformly high: https://palant.info/2025/01/13/chrome-web-store-is-a-mess/
- Many blogs (extensionbooster, extensionradar, etc.) are vendor content; their numbers (e.g. "80% of rejections") are unsourced.
