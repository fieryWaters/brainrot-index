// Landing page: what BrainRot Index does, a before and after of a filtered
// feed, how it works, the built-in filters, the price, questions people ask
// (including what data is collected), and the ways in.

import { el } from '../lib/dom.js'
import { getState } from '../lib/auth.js'
import { PRICE_PER_MONTH, TRIAL_DAYS } from '../lib/site.js'
import { createLogoMark } from '../components/LogoMark.js'

const PRIMARY_LINK_CLASS = 'inline-block px-6 py-3 rounded-xl font-bold bg-gradient-to-r from-shield-400 to-shield-600 hover:to-shield-400 hover:shadow-lg hover:shadow-glow-400/20 text-white transition-all'
const SECONDARY_LINK_CLASS = 'inline-block px-6 py-3 rounded-xl font-medium bg-white/10 hover:bg-white/20 transition-colors'
const SECTION_CLASS = 'max-w-5xl mx-auto px-4 py-16 sm:py-20'
const SECTION_TITLE_CLASS = 'text-2xl sm:text-3xl font-bold text-white'

function link(className, text, href) {
  const anchor = el('a', className, text)
  anchor.href = href
  return anchor
}

// The main call to action: sign up, or the dashboard for someone signed in.
function startLink() {
  if (getState().isAuthenticated) return link(PRIMARY_LINK_CLASS, 'Go to your dashboard', '/dashboard')
  return link(PRIMARY_LINK_CLASS, `Start your free ${TRIAL_DAYS}-day trial`, '/signup')
}

// -- The before and after feed. Every post here is made up. --

const MOCK_POSTS = [
  {
    name: 'Viral Daily', handle: '@viraldaily_now', avatarClass: 'bg-sky-600',
    text: 'You will NOT believe what this guy said to the gate agent. Reply "MORE" and I will send you part 2. Like if you agree!!',
    flag: { action: 'hide', plugin: 'Engagement bait', label: 'Asks for engagement', score: 94 },
  },
  {
    name: 'Maya Lindqvist', handle: '@mayabuilds', avatarClass: 'bg-emerald-600',
    text: 'Finished restoring my grandfather\'s 1962 road bike. Three months of evenings, one new chain and a lot of patience.',
    image: 'bg-gradient-to-br from-emerald-900 via-teal-800 to-slate-800',
  },
  {
    name: 'Hot Takes Central', handle: '@hottakescentral', avatarClass: 'bg-rose-600',
    text: 'People from that city are the reason this country is falling apart. Every single one of them. Disgusting.',
    flag: { action: 'blur', plugin: 'Ragebait', label: 'Blames a group', score: 91 },
  },
  {
    name: 'Ines Okafor', handle: '@ines_explains', avatarClass: 'bg-indigo-600',
    text: 'Why are there two high tides a day and not one? The Moon pulls the near side of the ocean, and the far side gets left behind.',
  },
  {
    name: 'sigma grindset', handle: '@skibidi_lord_99', avatarClass: 'bg-fuchsia-600',
    text: 'when the rizz is bussin but the gyatt is not mewing fr fr no cap ohio final boss compilation pt 47',
    flag: { action: 'hide', plugin: 'Brainrot', label: 'Meme-slang loop', score: 88 },
  },
]

function mockPost(post, blurred = false) {
  const body = el('div', 'flex gap-3 p-4',
    el('div', `shrink-0 w-9 h-9 rounded-full ${post.avatarClass} flex items-center justify-center text-sm font-bold text-white`, post.name[0]),
    el('div', 'min-w-0 flex-1',
      el('p', 'text-sm truncate',
        el('span', 'font-semibold text-white', post.name),
        el('span', 'text-white/40', ` ${post.handle}`)),
      el('p', 'mt-1 text-sm text-white/80 leading-snug', post.text),
      post.image ? el('div', `mt-3 h-28 rounded-xl ${post.image}`) : ''))
  if (blurred) body.classList.add('blur-md', 'select-none')
  body.setAttribute('aria-hidden', String(blurred))
  return body
}

function noticeText(flag) {
  const verb = flag.action === 'hide' ? 'Hidden' : 'Blurred'
  return `${verb} - ${flag.plugin}: ${flag.label} (${flag.score}/100)`
}

function noticeLine(flag, className) {
  return el('div', `flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs inset-shadow-[3px_0_0_var(--color-shield-300)] ${className}`,
    el('span', 'flex-1 min-w-0', noticeText(flag)),
    el('span', 'font-semibold text-glow-300', 'Show'))
}

function mockFeed(title, filtered) {
  const items = MOCK_POSTS.map((post) => {
    if (!filtered || !post.flag) {
      return el('li', 'border-t border-white/10 first:border-t-0', mockPost(post))
    }
    if (post.flag.action === 'hide') {
      return el('li', 'border-t border-white/10 first:border-t-0 p-2',
        noticeLine(post.flag, 'bg-white/5 border border-white/10 text-white/60'))
    }
    return el('li', 'relative border-t border-white/10 first:border-t-0 overflow-hidden',
      mockPost(post, true),
      el('div', 'absolute top-2 left-2 right-2',
        noticeLine(post.flag, 'bg-zinc-900/90 border border-white/15 text-zinc-100 shadow-lg')))
  })
  return el('figure', 'min-w-0',
    el('figcaption', filtered ? 'mb-3 text-sm font-semibold text-glow-300' : 'mb-3 text-sm font-semibold text-white/50', title),
    el('ul', 'rounded-2xl border border-white/10 bg-navy-900/60', ...items))
}

// -- Sections --

function heroSection() {
  const howLink = link(SECONDARY_LINK_CLASS, 'See how it works', '#how-it-works')
  return el('section', 'max-w-5xl mx-auto px-4 pt-12 pb-10 sm:pt-16 text-center',
    createLogoMark('mx-auto mb-6 w-28 h-28 sm:w-36 sm:h-36'),
    el('h1', 'mx-auto max-w-3xl text-4xl sm:text-6xl font-extrabold leading-tight tracking-tight bg-gradient-to-r from-glow-200 via-glow-300 to-glow-400 bg-clip-text text-transparent',
      'The algorithm that works for you'),
    el('p', 'mx-auto mt-6 max-w-2xl text-lg sm:text-xl text-white/70',
      'Your feeds are tuned to keep you scrolling. BrainRot Index is tuned by you: a browser extension that reads your feed with AI and clears out the brainrot, ragebait and engagement bait before you scroll past it. You choose what goes.'),
    el('div', 'mt-8 flex flex-wrap gap-3 justify-center', startLink(), howLink),
    el('p', 'mt-4 text-sm text-white/50',
      `${TRIAL_DAYS} days free, no card needed. Then ${PRICE_PER_MONTH} a month. For Brave and Chrome on a computer.`))
}

function beforeAfterSection() {
  return el('section', 'max-w-5xl mx-auto px-4 pb-16',
    el('div', 'grid gap-8 md:grid-cols-2',
      mockFeed('Your feed today', false),
      mockFeed('Your feed with BrainRot Index', true)),
    el('p', 'mt-4 text-center text-xs text-white/40', 'An illustration. The posts and accounts are made up.'))
}

function howItWorksSection() {
  const steps = [
    ['Create an account', `Sign up with your email or Google. The first ${TRIAL_DAYS} days are free and need no card.`],
    ['Add the extension', 'Install BrainRot Index in Brave or Chrome and press Connect on your dashboard. It takes about two minutes.'],
    ['Scroll like always', 'Each post is checked as it appears. Flagged ones are blurred or folded into one line that says why. One click shows any of them.'],
  ]
  const section = el('section', SECTION_CLASS,
    el('h2', SECTION_TITLE_CLASS + ' text-center', 'How it works'),
    el('ol', 'mt-10 grid gap-6 sm:grid-cols-3',
      ...steps.map(([title, text], index) => el('li', 'rounded-2xl border border-white/10 bg-black/30 p-6',
        el('span', 'w-9 h-9 rounded-full bg-shield-400/25 text-glow-300 font-bold flex items-center justify-center', String(index + 1)),
        el('h3', 'mt-4 font-semibold text-white', title),
        el('p', 'mt-2 text-sm text-white/60', text)))))
  section.id = 'how-it-works'
  return section
}

function filtersSection() {
  const filters = [
    ['Engagement bait', 'Posts made to farm replies, likes and shares: "comment YES if you agree", fake polls, invented drama.'],
    ['Ragebait', 'Posts built to make you angry: blaming whole groups of people, outrage framing, dunking on someone for clicks.'],
    ['Brainrot', 'Attention sinks with nothing inside: meme-slang loops, low-effort shitposts, absurd image macros.'],
    ['AI slop', 'Mass-produced generated content: generic flattering AI replies, reply-guy promotion, generated image bait.'],
  ]
  const controls = [
    ['How strict', 'Each filter scores posts from 0 to 100. Slide its threshold to catch more or less.'],
    ['Blur or hide', 'Blur keeps the post in place behind a label. Hide folds it into one line.'],
    ['Always your call', 'Show reveals any filtered post. Wrong? tells us about a mistake so the filters improve.'],
    ['Child mode', 'Posts stay blurred until they are checked, and filtered posts cannot be revealed.'],
  ]
  return el('section', SECTION_CLASS,
    el('h2', SECTION_TITLE_CLASS, 'Four filters built in'),
    el('p', 'mt-3 max-w-2xl text-white/60', 'Each filter is a detailed rubric an AI model applies to every post and reply, with its text and images. Turn each one on or off.'),
    el('div', 'mt-8 grid gap-4 sm:grid-cols-2',
      ...filters.map(([name, text]) => el('div', 'rounded-2xl border border-white/10 bg-black/30 p-5',
        el('h3', 'font-semibold text-glow-300', name),
        el('p', 'mt-1 text-sm text-white/70', text)))),
    el('h3', 'mt-12 text-xl font-semibold text-white', 'You stay in control'),
    el('dl', 'mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2',
      ...controls.map(([term, text]) => el('div', '',
        el('dt', 'font-semibold text-white', term),
        el('dd', 'text-sm text-white/60', text)))))
}

function pricingSection() {
  const section = el('section', SECTION_CLASS + ' text-center',
    el('h2', SECTION_TITLE_CLASS, 'One plan, one price'),
    el('div', 'mx-auto mt-8 max-w-sm rounded-2xl border border-glow-400/30 bg-black/30 p-8',
      el('p', 'text-5xl font-extrabold text-white', PRICE_PER_MONTH,
        el('span', 'text-lg font-medium text-white/50', ' / month')),
      el('ul', 'mt-6 space-y-2 text-sm text-white/70 text-left',
        el('li', '', `Free for the first ${TRIAL_DAYS} days, no card needed`),
        el('li', '', 'Every built-in filter, on every supported site'),
        el('li', '', 'Your own strictness and blur or hide per filter'),
        el('li', '', 'Cancel any time from your dashboard')),
      el('div', 'mt-8', startLink())))
  section.id = 'pricing'
  return section
}

const FAQ = [
  ['Which browsers does it work in?',
    'Brave and Google Chrome on Windows, Mac and Linux. Other browsers built on Chrome, such as Microsoft Edge, work too. It does not run on phones yet.'],
  ['Which sites does it work on?',
    'X, Reddit and YouTube today: your feeds, the replies under a post, and the videos YouTube suggests and finds for you.'],
  ['What data does it collect?',
    'While it is switched on, the extension sends us the content of the posts and videos it checks on supported sites, and we keep it with your account to run the filters, improve them and keep the service safe. To check posts we share them with service providers that help us run the service, including AI model providers. The extension does not read your messages, what you type, or other sites.'],
  ['Do you sell my data or show ads?',
    'No. We do not sell your data or use it for advertising. You pay for BrainRot Index, so it does not need to make money from you any other way.'],
  ['What if it hides something I wanted to see?',
    'Press Show on the post\'s label to see it right where it was. Press Wrong? to tell us, and turn the filter\'s threshold up if it is too strict for you.'],
  ['Does it slow my feed down?',
    'No. Posts appear normally while they are checked, and most are checked within a second or two. A post someone else already saw is answered at once.'],
  ['Is child mode a parental control?',
    'It is a stricter filter: posts stay blurred until checked and cannot be revealed. A child who can manage the browser\'s extensions can still remove it.'],
  ['How do I cancel?',
    'Open your dashboard and press Manage subscription. Filtering keeps working until the end of the month you paid for, and you are not charged again. You can also delete your account and its data from the Account page.'],
]

function faqSection() {
  const privacyLink = link('text-glow-400 hover:text-glow-300 underline', 'Read the Privacy Policy', '/privacy')
  const section = el('section', SECTION_CLASS,
    el('h2', SECTION_TITLE_CLASS, 'Questions'),
    el('div', 'mt-8 divide-y divide-white/10 rounded-2xl border border-white/10 bg-black/30',
      ...FAQ.map(([question, answer]) => el('details', 'group px-5 py-4',
        el('summary', 'cursor-pointer list-none flex items-center justify-between gap-4 font-semibold text-white',
          question,
          el('span', 'text-white/40 transition-transform group-open:rotate-45 text-xl leading-none', '+')),
        el('p', 'mt-3 text-sm text-white/70', answer)))),
    el('p', 'mt-6 text-sm text-white/60', privacyLink, ' for what is collected and why.'))
  section.id = 'faq'
  return section
}

function closingSection() {
  return el('section', 'max-w-5xl mx-auto px-4 pb-24 text-center',
    el('h2', SECTION_TITLE_CLASS, 'Take your feed back'),
    el('p', 'mt-3 text-white/60', 'Try it free for a week. Keep it if your scrolling feels better.'),
    el('div', 'mt-8 flex flex-wrap gap-3 justify-center', startLink(), link(SECONDARY_LINK_CLASS, 'Install the extension', '/install')))
}

export function mountLandingPage() {
  // The logo's navy, lit from above, behind the top of the page.
  const root = el('div', 'bg-[radial-gradient(ellipse_70%_900px_at_50%_0%,var(--color-navy-800),transparent)]',
    heroSection(),
    beforeAfterSection(),
    howItWorksSection(),
    filtersSection(),
    pricingSection(),
    faqSection(),
    closingSection())
  return { el: root }
}
