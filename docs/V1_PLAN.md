# Brainrot Index: v1 plan

This document records what the owner asked for and the decisions the owner made
while the first version was being built (2026-11-15 to 2026-11-16). Block quotes
are the owner's words, verbatim, including typos. Text outside block quotes only
says what question a quote was answering. Implementation choices made by the
engineers are deliberately not recorded here.

## The original brief

> I want you to make a site for me, brainrotindex.com, which I have the DNS for already, I have cloudflares DNS tool available at the machine "ssh spark"
>
> I have another git repo you art studios web in git repos there too which contains another website I built. Use that site as a template for all the devisions which can be shared between the two websites.
>
> I also have a brainrot index repo too on my github, with main not being the most updated branch.
>
> The landing page should allow sign up, 7 day free trial, monthly subscription
>
> High level idea of the app is to create an extension that looks at your social media browsing and allows plugins that run and classify content on the sites and optionally block because of it. Originally I wanted to target safari but now I'm using Brave, but both should work. Can you do computer use? Will want to give full control so you can mess with installing our extension.
>
> I'm imagining a plugin store where plugins can be rated and installed. A plugin is basically a prompt which runs on each social media post which puts the media into it then instructs the LLM to return a classification on the content, Like allow, block, hide, etc (rough idea those are what I want but havent deeply thought it out)
>
> Target rn is a mode for adults and a mode for children. You can join a family, basically people can join as adults or children. Person who pays is super admin, can control who else is admins or superadmins. Fellow parent might be super admin (can change others settings) whereas adult child might be an admin (change their own settings) vs child (limited control over settings) Rn target modalities are text and images (which LLM's can easily classify.) Target platforms are youtube, X, Reddit. Project initially focused on youtube first but I think that one is harder, focus on Reddit and X.
>
> Baseline filters for brainrot, ragebait/negativity, engagement bait (I dumped my BF after he told me to go fuck myself, am I the asshole? etc) theres other clear negative patterns, at some point have an agent to research to identify top ones dont just copy paste my dumb idea (even though I might be a genious)
>
> Each classification saves to a DB, basically we are caching all social media posts, along with the prompt, thinking trace and classification (for debugging and redundancy) each post only takes inference once.
>
> Basic performance requirements, for example loading times optimized, etc.
>
> Have a switch somewhere specifying source. We want to support local inference for debugging to save $$$ but also for performance testing we might want to try openrouter using a cheap model like 3.8 flash next or even 3.6 9b (whatever is cheap and works). Ideally we create a classification dataset with "right" answers and we can test against that and audit it. Want to support a "knob" that turns up/down what level of brainrot content to block, so prompts should have clear rubriks, minimum two choices but also possibly a score too.
>
> Use Opus for code work, sonnet for easy research tasks with easy clear results, Fable (you) for core decision making and architecture. Basically utilize agents so you can see the task through end to end.
>
> deploy on spark in docker. Do you have any questions for me? Anything underspecified? Probably you will want to navigate to git repos on spark or here and check latest youartstudios tbh though most recent version is in "ssh youart-agent-test" which is an lxc on spark.

## Scope of v1 versus v2

> Basically v1: prototype I can use and is responsive and I want to use. V2 we hook up all the things that make it a public site

## Core focus

> I want to focus most on getting core functionality up, working and ergonomical. The other stuff is mostly copying keys and settings and such best done synchronously vs the app design can work async. Basically X filter main feed and when in a post filter replies for AI slop.
>
> Reddit filter as previously specified, including replies once in a thread too.
>
> Youtube filter mostly the thumbnail and against transcript, focus on Youtibe last.

## Decisions

### Who can publish plugins

Asked whether any user can publish a plugin in the first version, or only us:

> 3 anyone, they have to install it, and children cant install plugins. Besides, it cant talk back it just classifies.

### Child mode tamper-proofing

Asked whether real lock-down is in scope, given that a child can remove a browser extension:

> 4 meh, dont worry about it.

### Reusing YouArt Studios

Asked about sign-in and how much of the template to reuse:

> 5 aspects of design specified in youart studios should be used. Probably you can copy the codebase over and focus on the parts which are specific to this app.

### What the cache stores

> cache stores the post as well, we want to data mine

Asked whether to store the images themselves and not only their URLs:

> Yeah download everything

### Keys

> just copy the .env where you need it and dont read it and use regex to figure out if keys you need are there.

> Just use youartstudios keys for stripe to test, theres test keys there.

### Deployment

> yeah it can only be deployed to tailscale for now

> brainrot index is on my cloudflare acct and theres a CLI on spark to manage my cloudflare acct

### Merging

> you can merge to main

### Feedback from self-testing

> Also make sure theres an easy feedback mechanism on the site that saves the feedback long with commit hash user is running (to identiyf which ones are fixed already) so that way I can just use the app and collect self user-testing, or even put feedback somewhere in the extension, whatever you think best

## Questions the owner has not answered

These were asked and left open. Nothing here is a decision.

- The monthly subscription price.
- Whether Brainrot Index gets its own Stripe account for live payments. (Only the test keys were addressed, above.)
- What a reader sees for a post that has been sent for classification but not answered yet.
