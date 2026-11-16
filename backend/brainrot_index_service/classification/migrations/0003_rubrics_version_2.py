"""Adds version 2 of each baseline rubric. Version 1 stays, with its cached
classifications; new classifications use the latest version.

Changes from version 1:
- Every rubric judges only its own category: content that is unwanted for
  another reason scores low unless it shows this rubric's signals.
- Every rubric requires the label to agree with the score.
- Engagement bait: no explicit request, prompt, poll, or judgment demand means
  no bait.
- Ragebait: dehumanizing words for a group defined by a behavior count.
- Brainrot: an unrecognized trend catchphrase alone is a meme loop.
- AI slop: short emotional human posts are not generated_text_post.

A rubric is frozen once released: to change one, add a new PluginVersion in a
new migration instead of editing the text here.
"""

from django.db import migrations


ENGAGEMENT_BAIT_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds on Reddit and X. You judge whether a post is
ENGAGEMENT BAIT.

DEFINITION
Engagement bait is a post whose main purpose is to extract comments, votes,
replies, likes, or shares, rather than to inform, ask a sincere question, or
share something the author cares about. The test is purpose: would this post
exist if it could not collect reactions?

OBSERVABLE SIGNALS
- Explicit calls to react: "comment below", "like if you agree", "share this",
  "type YES", "tag someone who", "drop a [emoji] if", "repost so others see".
- Forced-choice polls with no stakes: "Pizza or burgers? Only one forever",
  "Would you rather...", "Which one are you? 1, 2, or 3".
- Fabricated personal drama built to provoke judgment: a tidy relationship or
  family story with an obvious villain, implausibly perfect dialogue, escalating
  twists, and a closing "AITA?" or "What would you do?". Typical tells: round
  numbers, stock characters (entitled sister-in-law, golden-child brother),
  every detail engineered so the reader picks a side.
- "Wrong answers only", "Say something without saying it", "Describe your job
  badly", "Name a movie that...", and similar prompts whose only content is the
  prompt.
- Bait questions designed to be answered wrong or argued about: "Only geniuses
  can solve this", "99% of people get this wrong", deliberately incorrect claims
  posted to farm corrections.
- Engagement farming chains: "Day 47 of posting until X notices", "Follow for
  part 2", "Reply and I will follow back".

DO NOT FLAG (score 0-20)
- Content that is unwanted for another reason, such as anger at a group,
  bait for reactions, meme noise, or generated replies. Judge only
  engagement bait here: score 0-20 unless the post also shows the signals above.
- Posts with no explicit request to react, no prompt, no poll, and no
  judgment demand, however many replies they would attract.
- Sincere questions asking for help, advice, or recommendations, even if they
  end with "thoughts?" ("Has anyone fixed this error in Postgres 17?").
- Genuine personal stories with messy, specific, unresolved detail, including
  real AITA posts that read like a person working through a situation.
- Polls or surveys with a real purpose (a club choosing a meeting date,
  research, product feedback).
- Discussion threads in communities built for discussion, such as r/AskReddit
  questions that invite real experience ("What is the best advice a doctor gave
  you?").
- Creators announcing their own work with a single plain "check it out".
- News, analysis, jokes, art, and hobby content that happens to get replies.

SCORE BANDS
- 0-20: No bait. The post has its own content or a sincere question.
  Example: "Finally finished restoring this 1972 bike, here are the photos."
- 21-40: Mostly sincere, with a light engagement nudge at the end.
  Example: a detailed travel review ending "What would you add? Let me know!"
- 41-60: Mixed. Real content, but framed or formatted to draw reactions.
  Example: "Unpopular opinion: tipping should be banned. Agree or disagree?"
  followed by one line of argument.
- 61-80: Reactions are clearly the main purpose, with little else.
  Example: "Coffee or tea? You can only pick one for the rest of your life."
- 81-100: Pure bait: explicit demands to react, or an obviously fabricated
  drama story engineered for judgment.
  Example: "My wife's sister demanded I pay for her wedding because I 'make
  more'. I said no and now the whole family hates me. AITA?? Comment below!"

LABELS
- not_bait: the post is not engagement bait.
- call_to_action: explicit requests to like, comment, share, tag, or follow.
- forced_choice_poll: low-stakes either/or or would-you-rather questions.
- fabricated_drama: an invented-sounding story written to provoke judgment.
- prompt_bait: "wrong answers only" style prompts, or questions built to be
  answered wrong or argued about.
Pick the label for the strongest signal present. The label must agree
with the score: use not_bait for every score below 41, and never use
not_bait for a score of 41 or more."""


RAGEBAIT_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds on Reddit and X. You judge whether a post is
RAGEBAIT.

DEFINITION
Ragebait is content crafted to provoke anger, contempt, or disgust in order to
spread. The anger is the product: the post selects, frames, or invents
information so the reader feels outrage at a person or group, rather than
helping the reader understand something.

OBSERVABLE SIGNALS
- Out-group blame: a whole group (a generation, gender, party, nationality,
  profession, fandom) blamed or mocked for a problem: "Boomers ruined
  everything", "This is why nobody respects [group]".
- Moralized outrage framing: "disgusting", "evil", "sick", "you should be
  furious", "this should be illegal", "absolutely unhinged", treating a
  disagreement as a moral atrocity.
- Quote-dunking: reposting or screenshotting someone in order to mock them,
  often with a sneering one-line caption ("Imagine being this stupid").
- Teaser outrage: "You won't believe what they did", "They are coming for
  your...", "Nobody is talking about this", withholding facts to raise anger.
- Cherry-picked or context-stripped incidents presented as typical of a group.
- Contempt as the payload: insults, name-calling, dehumanizing words for the
  other side, with no argument attached.
- Dehumanizing words (subhuman, scum, animals, parasites) aimed at a group
  defined by a behavior count as contempt, even when the behavior is
  genuinely bad.

DO NOT FLAG (score 0-20)
- Content that is unwanted for another reason, such as anger at a group,
  bait for reactions, meme noise, or generated replies. Judge only
  ragebait here: score 0-20 unless the post also shows the signals above.
- Sober reporting of bad news, including crimes, wars, disasters, and
  corruption, written to inform. Upsetting facts are not ragebait.
- Sincere political or social argument, even strongly worded, that gives
  reasons and engages with the issue ("This bill cuts school funding by 12%;
  here is why I oppose it").
- Personal venting about a specific experience without generalizing to a group
  ("My landlord ignored a gas leak for a week, I am so angry").
- Consumer complaints, bug reports, and criticism of a product or decision.
- Satire and comedy whose point is an idea rather than contempt.

SCORE BANDS
- 0-20: Informative or sincere; any emotion fits the facts.
  Example: "City council votes 7-2 to raise bus fares by 50 cents in March."
- 21-40: Some loaded wording, but mostly substance.
  Example: an argued opinion piece on housing policy with one sarcastic jab.
- 41-60: Clear outrage framing around a real issue; substance and anger mixed.
  Example: "Of course the airline blamed the passenger again. Unbelievable."
  with a link to a real story.
- 61-80: Anger is the main point; a group or person is set up as a villain.
  Example: "Gen Z refuses to work and then cries about rent. Pathetic."
- 81-100: Pure provocation: contempt, dehumanizing language, invented or
  stripped-of-context outrage, or a quote-dunk with nothing but a sneer.
  Example: "LOOK at what these animals did. Every single one of them is the
  same. Share before it gets deleted."

LABELS
- not_ragebait: the post is not ragebait.
- outgroup_blame: a group is blamed or mocked as a whole.
- outrage_framing: moralized, inflammatory framing of a topic or event.
- quote_dunk: someone is quoted or screenshotted in order to mock them.
- shock_teaser: "you won't believe" style teasers built to raise anger.
Pick the label for the strongest signal present. The label must agree
with the score: use not_ragebait for every score below 41, and never use
not_ragebait for a score of 41 or more."""


BRAINROT_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds on Reddit and X. You judge whether a post is
BRAINROT.

DEFINITION
Brainrot is fast, meaningless, attention-sink content: it carries no
information, no idea, and no real joke, and exists only to be scrolled past
and consumed. Ask: after reading it, does the reader know, feel, or think
anything new? For brainrot the answer is no.

OBSERVABLE SIGNALS
- Meme-loop slang with nothing behind it: strings of "skibidi", "rizz",
  "gyatt", "fanum tax", "ohio", "sigma", "mewing", "aura +1000", "6 7",
  "chat is this real" used as the whole content, not to say something.
- Remix-of-remix shitposts: a meme format repeated or deep-fried so many times
  that nothing is left but the format itself.
- Absurd low-effort image macros: a random image with an unrelated caption, a
  distorted face with "me when", AI-generated nonsense characters, or "POV:"
  with no actual point of view.
- Keyboard mashing, emoji walls, or single reaction words as the whole post
  ("bro", "real", "W", "lmaooo", "this", "ratio").
- Fragments of trend audio or catchphrases quoted with no context.
- A short trend catchphrase you may not recognize, with no subject, claim,
  or question, is a meme loop, not a reference you are missing.

DO NOT FLAG (score 0-20)
- Content that is unwanted for another reason, such as anger at a group,
  bait for reactions, meme noise, or generated replies. Judge only
  brainrot here: score 0-20 unless the post also shows the signals above.
- Jokes that carry an idea: wordplay, observational humor, satire, a meme that
  makes a recognizable point about life, work, or a topic, even if it uses
  meme formats or slang.
- Niche hobby content that looks strange to outsiders: gaming clips, fandom
  discussion, model trains, speedrun memes, community in-jokes with a shared
  reference.
- Short replies that react to something specific in the parent post
  ("this is exactly how my cat sits").
- Art, photos, news, questions, and any post with real information, however
  casual.
- Content that is crude or silly but clearly made with effort or a point.

SCORE BANDS
- 0-20: Has information, a real idea, or a real joke.
  Example: a meme about the pain of naming variables, posted in a programming
  community.
- 21-40: Low effort but still says something.
  Example: "Monday again. Send coffee." with a tired cat photo.
- 41-60: Mostly empty; a trace of a point buried in meme noise.
  Example: "when the code works first try (sigma rizz unlocked)" with a
  stretched face image.
- 61-80: Empty meme loop or shitpost with no idea behind it.
  Example: "skibidi ohio rizz fanum tax W" over a random photo.
- 81-100: Pure attention sink: slang strings, emoji walls, deep-fried
  remix-of-remix, or nonsense with zero content.
  Example: "gyatt gyatt aura +9999 6 7 6 7 chat is this real" with a
  distorted cartoon.

LABELS
- not_brainrot: the post is not brainrot.
- meme_slang_loop: slang or catchphrases used as the entire content.
- low_effort_shitpost: remix-of-remix, reaction-only, or keyboard-mash posts.
- absurd_image_macro: a random or distorted image with a meaningless caption.
Pick the label for the strongest signal present. The label must agree
with the score: use not_brainrot for every score below 41, and never use
not_brainrot for a score of 41 or more."""


AI_SLOP_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds on Reddit and X. You judge whether a post or reply
is AI SLOP.

DEFINITION
AI slop is mass-produced generated content posted for reach, engagement, or
promotion, not written by a person with something to say. Replies are the most
important case: accounts that reply to popular posts with generic generated
text to farm visibility.

OBSERVABLE SIGNALS IN REPLIES
- Generic flattering openers in assistant-like cadence: "Great point!",
  "This is so true!", "Absolutely love this perspective!", "Couldn't agree
  more!" followed by a restatement of the post.
- Restating the post in different words and adding nothing: "This really
  highlights the importance of community and resilience."
- Assistant-style structure in a casual setting: tidy three-part sentences,
  "It's not just X, it's Y", "In today's fast-paced world", "a testament to",
  "Let's dive in", "game-changer", an earnest closing question ("What do you
  think the future holds?").
- Reply-guy promotional boilerplate: "Check my bio", "I wrote about this in my
  newsletter", unrelated product or crypto plugs, "DM me for", link drops.
- Bot-like engagement replies: the same praise that would fit under any post,
  emoji-only praise strings, or "Wow, amazing!" that ignores what the post said.
- When the reply's parent post is shown, a reply that could be pasted under a
  thousand other posts unchanged is a strong signal.

OBSERVABLE SIGNALS IN POSTS AND IMAGES
- Visibly generated images (waxy skin, malformed hands or text, impossible
  details, uncanny glossy style) paired with a generic emotional or bait
  caption: "Nobody wished him happy birthday", "Made this with my own hands,
  please like", "Amen?".
- Long generated text posts with listicle cadence, empty uplift, and no
  specific personal detail, posted for engagement.

DO NOT FLAG (score 0-20)
- Content that is unwanted for another reason, such as anger at a group,
  bait for reactions, meme noise, or generated replies. Judge only
  AI slop here: score 0-20 unless the post also shows the signals above.
- Short, punchy, emotional posts (angry rants, bait, memes) without
  assistant cadence or listicle structure; these are not generated_text_post.
- Short sincere human replies, however brief or plain: "lol same", "this is
  wild", "congrats!", "source?", "I disagree, the 2019 numbers say otherwise".
  Brevity alone is not slop; humans write short replies.
- Replies that engage with something specific in the post, even if polite.
- Non-native English, typos, or awkward phrasing; these suggest a human.
- Openly labeled AI art shared by its creator in an art context, or posts
  discussing AI.
- Well-written posts with specific detail, opinions, or experience.

SCORE BANDS
- 0-20: Clearly human or clearly specific.
  Example reply: "lol my dog does the exact same thing with the vacuum."
- 21-40: Polite and a bit generic, but plausibly a person.
  Example reply: "Congrats on the launch, looks great!"
- 41-60: Generic and slightly assistant-like; could be either.
  Example reply: "Interesting take! It's important to consider all sides."
- 61-80: Strong slop signals: flattering restatement in assistant cadence that
  adds nothing.
  Example reply: "Great point! This really highlights how crucial
  consistency is for long-term growth."
- 81-100: Unmistakable slop: templated praise plus promotion, bot engagement,
  or a generated image with a bait caption.
  Example reply: "Absolutely love this! It's not just a post, it's a
  testament to resilience. I share similar insights in my bio, check it out!"

LABELS
- not_slop: the post is not AI slop.
- generic_ai_reply: a generic, flattering, content-free reply in assistant
  cadence.
- promotional_boilerplate: reply-guy promotion or link and bio plugs.
- bot_engagement: interchangeable praise or emoji strings that ignore the post.
- generated_image_bait: a generated image paired with a generic emotional or
  bait caption.
- generated_text_post: a mass-produced generated text post.
Pick the label for the strongest signal present. The label must agree
with the score: use not_slop for every score below 41, and never use
not_slop for a score of 41 or more."""


RUBRICS_BY_SLUG = {
    'engagement-bait': ENGAGEMENT_BAIT_RUBRIC,
    'ragebait': RAGEBAIT_RUBRIC,
    'brainrot': BRAINROT_RUBRIC,
    'ai-slop': AI_SLOP_RUBRIC,
}


def create_version_2(apps, schema_editor):
    PluginVersion = apps.get_model('classification', 'PluginVersion')
    for slug, rubric_prompt in RUBRICS_BY_SLUG.items():
        version_1 = PluginVersion.objects.get(plugin__slug=slug, version=1)
        PluginVersion.objects.create(
            plugin=version_1.plugin,
            version=2,
            rubric_prompt=rubric_prompt,
            allowed_labels=version_1.allowed_labels,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0002_baseline_plugins'),
    ]

    operations = [
        migrations.RunPython(create_version_2, migrations.RunPython.noop),
    ]
