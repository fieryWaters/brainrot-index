"""Adds five official plugins to the store, written by Brainrot Index. Unlike
the baseline plugins they are not installed for anyone: each one a person
turns on is one more model call for every new post they see.

suggested_for_children marks the ones the family page suggests when a
superadmin edits a child's plugins.

A rubric is frozen once released: to change one, add a new PluginVersion in a
new migration instead of editing the text here.
"""

from django.db import migrations, models


MONEY_HYPE_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is MONEY HYPE.

DEFINITION
Money hype is a post that promises outsized, fast, or easy financial gain, or
pushes a risky money product (cryptocurrency, tokens, sports betting, casino
apps, trading signals, paid trading or "wealth" courses) using urgency, social
proof, or flaunted wealth instead of honest information. The test is the pitch:
does the post try to make the reader feel they must act now to get rich or
miss out?

OBSERVABLE SIGNALS
- Promised returns or price targets: "10x by Friday", "this coin will make you
  a millionaire", "I made $40k this month and you can too".
- Urgency and scarcity: "last chance", "before it's too late", "only 50 spots
  left", "presale ends tonight".
- Social proof built to pressure: screenshots of gains or payouts, "join 20,000
  members already winning", testimonials with luxury cars and cash.
- Pushing a product or channel: referral links, promo codes for betting or
  exchange sign-ups, "DM me for signals", "link in bio for my course".
- Lifestyle bait: rented-jet and watch photos framed as proof that a method
  works, "quit your 9-5" pitches.
- Risk hidden or denied: "guaranteed", "risk-free", "can't lose".

DO NOT FLAG (score 0-20)
- Content that is unwanted for another reason, such as anger at a group,
  bait for reactions, meme noise, or generated replies. Judge only money hype
  here: score 0-20 unless the post also shows the signals above.
- Sober investing or personal finance education: index funds, budgeting,
  explaining how an option works, discussing risk honestly.
- Financial news and market reporting, including crypto news, without a pitch.
- Sincere questions about money ("Is it worth paying off my car early?").
- People sharing a real outcome without selling anything, including losses.
- Jokes about being broke or about the market that push no product.

SCORE BANDS
- 0-20: No hype. Information, news, a question, or ordinary talk about money.
  Example: "Bitcoin fell 8% today after the rate decision; here is the chart."
- 21-40: Enthusiastic but not a pitch: an opinion about an asset with no
  urgency, link, or promise.
  Example: "I'm bullish on solar stocks this year, the margins look good."
- 41-60: Some hype: a confident gain claim or mild urgency, with little push.
  Example: "This token is still early, could easily go 5x."
- 61-80: Clear money hype: promised gains plus urgency or social proof, or a
  risky product pushed with a link or code.
  Example: "I turned $500 into $9k with these signals. Free group for the next
  24 hours only, link in bio."
- 81-100: Unmistakable: guaranteed riches, flaunted wealth as proof, and a
  hard push to buy, bet, or sign up now.
  Example: "GUARANTEED 100x. Presale closes tonight. My students bought
  Lambos. Don't be poor forever, buy now!"

LABELS
- not_money_hype: the post is not money hype.
- get_rich_quick: promises of easy, fast, or outsized gains.
- risky_product_push: crypto, betting, signals, or courses pushed with a link,
  code, or call to buy.
- wealth_flaunting: displayed wealth or payouts used as proof that a method
  works.
Pick the label for the strongest signal present. The label must agree
with the score: use not_money_hype for every score below 41, and never use
not_money_hype for a score of 41 or more."""


BODY_PRESSURE_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post applies BODY PRESSURE.

DEFINITION
Body pressure is content that presents a particular body as the goal or as a
measure of a person's worth, or presents dieting, restriction, or changing the
body's size and shape as the way to be acceptable. The test is the message to
the reader: does the post suggest their body is not good enough until it looks
a certain way?

OBSERVABLE SIGNALS
- Before and after photos framed as a transformation from worse to better
  person, "glow up" body comparisons, "what I eat to stay this thin".
- Ranking or rating bodies, "ideal body type" content, body checks (posing to
  show thinness, ribs, thigh gaps, or extreme muscle as an achievement).
- Restriction as a goal: very low calorie counts, skipping meals, "what I eat
  in a day" built around eating as little as possible, "nothing tastes as good
  as skinny feels".
- Shame or worth tied to the body: "no one will date you looking like that",
  "summer body or stay home", mocking someone's weight.
- Appearance products sold through insecurity: waist trainers, appetite
  suppressants, "fat burner" teas, cosmetic procedures pitched to fix flaws.

DO NOT FLAG (score 0-20)
- Content that is unwanted for another reason, such as anger at a group,
  bait for reactions, meme noise, or generated replies. Judge only body
  pressure here: score 0-20 unless the post also shows the signals above.
- Body-positive or body-neutral content, and people sharing photos of
  themselves without comparison or judgment.
- Ordinary fitness: workouts, training progress measured in strength or
  endurance, sports, healthy recipes without restriction framing.
- Medical and health information: a doctor explaining a condition, nutrition
  facts, recovery from illness or surgery.
- Fashion, makeup, and hairstyle content that does not judge bodies.

SCORE BANDS
- 0-20: No body pressure.
  Example: "Hit a new deadlift record today, 140 kg!"
- 21-40: Appearance-focused but mild: a fitness or style post with a faint
  hint of an ideal.
  Example: "Working on getting leaner for summer, week 3 of training."
- 41-60: Some pressure: a body presented as the goal, or diet talk that leans
  toward restriction.
  Example: "My 1,200 calorie day to get that snatched waist."
- 61-80: Clear pressure: before and after framed as becoming a better person,
  body checks, or worth tied to size.
  Example: "Me fat vs me now. Finally someone people actually want to look
  at."
- 81-100: Extreme: praise of very low intake or visible thinness as success,
  or shaming bodies outright.
  Example: "Ate 400 calories today, collarbones finally showing. If you can
  pinch an inch you have no excuse."

LABELS
- not_body_pressure: the post does not apply body pressure.
- body_ideal: a body type presented as the goal or ranked above others.
- transformation_comparison: before and after or comparison content framed as
  becoming better.
- restriction_promotion: dieting, restriction, or low intake presented as the
  goal.
- body_shaming: mocking or judging a body, or tying worth to it.
Pick the label for the strongest signal present. The label must agree
with the score: use not_body_pressure for every score below 41, and never use
not_body_pressure for a score of 41 or more."""


SELF_HARM_ADJACENT_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is SELF-HARM ADJACENT.

DEFINITION
Self-harm adjacent content glorifies, instructs, encourages, or normalizes
self-harm, suicide, or disordered eating, including through coded terms and
aesthetics. The central test is the stance of the post: does it present harm
as appealing, normal, deserved, or something to do, or does it point toward
safety, recovery, and help? A post can discuss these topics openly and still
be supportive; discussing a topic is not the same as promoting it.

OBSERVABLE SIGNALS
- Glorifying or romanticizing: harm, scars, starvation, or death shown as
  beautiful, poetic, or deserved; "sad aesthetic" posts that make harm look
  appealing.
- Instructions or methods: how to hurt oneself, hide injuries, purge, fast for
  days, or end one's life, including tips framed as "asking for a friend".
- Encouragement: telling someone to hurt themselves, "kys", "you should just
  starve", pro-ana or "thinspo" coaching, accountability groups for
  restriction.
- Normalizing as a solution: harm presented as the obvious way to cope ("only
  thing that helps is the blade").
- Coded terms used in a promoting way: "unalive" jokes urging someone to do
  it, "thinspo", "meanspo", "bonespo", "ana coach", "sh" with tallies or
  streaks, "cat scratches" for cuts, "ed twt" content.

DO NOT FLAG (score 0-20)
- Content that is unwanted for another reason, such as anger at a group,
  bait for reactions, meme noise, or generated replies. Judge only this
  category here: score 0-20 unless the post also shows the signals above.
- Recovery posts: "one year clean from self-harm today", "eating three meals
  again", sharing struggles in the past tense with hope.
- Support and help: crisis line numbers, "please reach out", checking on a
  friend, therapists or organizations explaining warning signs.
- Awareness and news: reporting on suicide statistics or a public figure's
  death responsibly, without method detail.
- Someone expressing their own pain and asking for help ("I feel like hurting
  myself, can someone talk to me?"). This is a person in need, not promotion;
  score it low.
- Fiction, history, or art that depicts these topics without making them
  appealing or giving methods.

SCORE BANDS
- 0-20: Supportive, recovery-focused, informative, or unrelated.
  Example: "If you're struggling tonight, you can call or text 988. You are
  not a burden."
- 21-40: Heavy or dark, but not promoting harm: venting, grief, dark humor
  that does not urge anyone.
  Example: "Rough week, my depression is kicking my butt again."
- 41-60: Leaning toward normalizing: harm or restriction mentioned as a
  casual or understandable coping method, or coded terms used approvingly.
  Example: "honestly sh is the only thing that gets me through exams lol"
- 61-80: Clear glorification or encouragement: harm made to look appealing,
  pro-restriction coaching, or telling someone to hurt themselves.
  Example: "Thinspo for tonight: if you eat you lose. Stay strong, no food
  until Friday."
- 81-100: Instructions, methods, or direct incitement.
  Example: a post explaining how to hide cuts from parents, or "kys, nobody
  would miss you."

LABELS
- not_self_harm_adjacent: the post does not promote self-harm, suicide, or
  disordered eating.
- glorification: harm, suicide, or starvation presented as appealing or
  deserved.
- instruction: methods, tips, or ways to hide harm.
- encouragement: urging someone toward harm, or pro-restriction coaching.
- normalization: harm or restriction presented as an ordinary way to cope.
Pick the label for the strongest signal present. The label must agree
with the score: use not_self_harm_adjacent for every score below 41, and never
use not_self_harm_adjacent for a score of 41 or more."""


DOOM_FRAMING_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post uses DOOM FRAMING.

DEFINITION
Doom framing presents news or trends as imminent collapse, catastrophe, or
threat in a way designed to alarm, with no actionable information for the
reader. The test is what the reader can do with it: a post that leaves them
only with dread, and nothing to check, prepare, or act on, is doom framing.

OBSERVABLE SIGNALS
- Collapse language: "it's over", "society is collapsing", "we have months
  left", "the end of [country, the economy, the internet] is here".
- Catastrophizing a single event or statistic into certain disaster, without
  context, sources, or proportion.
- Countdown and inevitability framing: "nothing can stop this now", "prepare
  for the worst", "you're not ready for what's coming".
- Stacked bad news with no explanation of what it means for the reader or
  what they could do.
- Alarm used to drive engagement: "share before this gets deleted", "they
  don't want you to know".

DO NOT FLAG (score 0-20)
- Content that is unwanted for another reason, such as anger at a group,
  bait for reactions, meme noise, or generated replies. Judge only doom
  framing here: score 0-20 unless the post also shows the signals above.
- Real emergency information and warnings: evacuation orders, storm and fire
  alerts, product recalls, outbreak guidance, anything that tells people what
  to do or where to check.
- Serious news reported with context and proportion, even if the news is bad.
- Analysis that explains causes, likely outcomes, and uncertainty.
- Calls to a specific action: voting, contacting a representative, donating,
  preparing a kit, with concrete steps.
- Personal worry expressed without spreading alarm ("climate news makes me
  anxious, how do you cope?").

SCORE BANDS
- 0-20: Informative, proportionate, or actionable.
  Example: "Flood warning for the river valley until 6 pm. Avoid Route 9;
  shelters are open at the high school."
- 21-40: Bad news with some alarm in the wording, but with context or a
  source.
  Example: "Grim jobs report: unemployment up to 5.1%, the highest in three
  years. Details in the thread."
- 41-60: Alarm outweighs information: dramatic framing with little context.
  Example: "The housing market is about to crash hard. Get ready."
- 61-80: Clear doom framing: imminent collapse presented as certain, nothing
  to act on.
  Example: "It's over. The dollar has months left and nobody is talking about
  it. Everything you own will be worthless."
- 81-100: Pure dread for reach: apocalyptic certainty plus engagement bait.
  Example: "Civilization ends this decade and THEY know it. Share before this
  gets taken down."

LABELS
- not_doom: the post is not doom framing.
- collapse_prophecy: imminent collapse or catastrophe presented as certain.
- catastrophizing: one event or number blown up into disaster without context.
- alarm_for_engagement: dread used to drive shares or clicks.
Pick the label for the strongest signal present. The label must agree
with the score: use not_doom for every score below 41, and never use not_doom
for a score of 41 or more."""


HIDDEN_PROMO_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is HIDDEN PROMO.

DEFINITION
Hidden promo is a post that reads like a personal opinion, story, or
recommendation but is really a sales pitch or coordinated promotion, without a
clear disclosure such as "ad", "sponsored", or "I work for them". The test is
disguise: is the post selling something while pretending not to?

OBSERVABLE SIGNALS
- Discount or affiliate codes and links inside a casual story: "use my code
  SARAH20", "link in bio", tracking links.
- Fake disclaimers: "not sponsored but", "no one paid me to say this", "I
  never post about products but", followed by a polished pitch.
- Ad copy in a personal voice: brand names repeated, feature lists, price and
  where to buy, "life-changing", "game changer", "I can't believe this is not
  more popular".
- Coordinated praise: phrasing that reads like a template, the same product
  praised in the same words, an account that only ever recommends one brand.
- Problem-solution stories that end in a product: "I struggled with X for
  years until I found Y" with a link.
- Undisclosed self-promotion: recommending one's own product, app, or service
  as if a neutral user.

DO NOT FLAG (score 0-20)
- Content that is unwanted for another reason, such as anger at a group,
  bait for reactions, meme noise, or generated replies. Judge only hidden
  promo here: score 0-20 unless the post also shows the signals above.
- Honest recommendations with specific, balanced detail, including downsides,
  and no code or link.
- Answers to someone asking for a recommendation.
- Clearly disclosed ads and sponsorships ("#ad", "sponsored by", "I work
  here"), and creators plainly announcing their own work.
- Reviews and complaints, positive or negative, from ordinary use.
- News about products and companies.

SCORE BANDS
- 0-20: No promotion, or openly disclosed promotion.
  Example: "#ad Thanks to Acme for sponsoring this video."
- 21-40: A genuine-seeming recommendation with mild enthusiasm and no link.
  Example: "Been using this backpack for two years, the zipper finally broke
  but otherwise solid."
- 41-60: Some disguise: a personal story that drifts into product praise, or a
  brand pushed hard with no disclosure.
  Example: "Honestly this serum changed my skin. Everyone should try it."
- 61-80: Clear hidden promo: a pitch in a personal voice with a code, link, or
  fake disclaimer.
  Example: "Not sponsored, but this app literally fixed my sleep. Use code
  SLEEP30 for 30% off!"
- 81-100: Unmistakable: templated praise, an affiliate link, and a fake
  disclaimer together, or obviously coordinated posting.
  Example: "I NEVER recommend things but GlowMax is a GAME CHANGER, my
  wrinkles vanished in 3 days!! Link in bio, code GLOW50, hurry!!"

LABELS
- not_hidden_promo: the post is not hidden promotion.
- undisclosed_ad: a sales pitch posing as a personal opinion or story.
- affiliate_push: discount codes or affiliate links inside casual content.
- coordinated_praise: templated or identical-phrasing promotion.
- fake_disclaimer: "not sponsored but" or similar, followed by a pitch.
Pick the label for the strongest signal present. The label must agree
with the score: use not_hidden_promo for every score below 41, and never use
not_hidden_promo for a score of 41 or more."""


OFFICIAL_PLUGINS = [
    {
        'slug': 'money-hype',
        'name': 'Money Hype',
        'description': 'Hides get-rich-quick posts and pushes for crypto, betting, trading signals and money courses. Suggested for children; useful for anyone tired of hype.',
        'rubric_prompt': MONEY_HYPE_RUBRIC,
        'allowed_labels': ['not_money_hype', 'get_rich_quick', 'risky_product_push', 'wealth_flaunting'],
        'default_threshold': 60,
        'suggested_for_children': True,
    },
    {
        'slug': 'body-pressure',
        'name': 'Body Pressure',
        'description': 'Hides posts that hold up a body ideal, before and after comparisons, or dieting and restriction as the goal. Suggested for children and teens.',
        'rubric_prompt': BODY_PRESSURE_RUBRIC,
        'allowed_labels': ['not_body_pressure', 'body_ideal', 'transformation_comparison', 'restriction_promotion', 'body_shaming'],
        'default_threshold': 50,
        'suggested_for_children': True,
    },
    {
        'slug': 'self-harm-adjacent',
        'name': 'Self-Harm Adjacent',
        'description': 'Hides posts that glorify, teach or normalize self-harm, suicide or disordered eating, while leaving recovery and support posts alone. Suggested for children.',
        'rubric_prompt': SELF_HARM_ADJACENT_RUBRIC,
        'allowed_labels': ['not_self_harm_adjacent', 'glorification', 'instruction', 'encouragement', 'normalization'],
        'default_threshold': 40,
        'suggested_for_children': True,
    },
    {
        'slug': 'doom-framing',
        'name': 'Doom Framing',
        'description': 'Hides posts that frame the news as imminent collapse with nothing you can act on. Real warnings stay. For adults who want calmer feeds; opt in.',
        'rubric_prompt': DOOM_FRAMING_RUBRIC,
        'allowed_labels': ['not_doom', 'collapse_prophecy', 'catastrophizing', 'alarm_for_engagement'],
        'default_threshold': 60,
        'suggested_for_children': False,
    },
    {
        'slug': 'hidden-promo',
        'name': 'Hidden Promo',
        'description': 'Hides sales pitches dressed up as personal opinions: discount codes, "not sponsored but", and copy-paste praise. Honest recommendations stay. Suggested for children.',
        'rubric_prompt': HIDDEN_PROMO_RUBRIC,
        'allowed_labels': ['not_hidden_promo', 'undisclosed_ad', 'affiliate_push', 'coordinated_praise', 'fake_disclaimer'],
        'default_threshold': 60,
        'suggested_for_children': True,
    },
]


def create_official_plugins(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    PluginVersion = apps.get_model('classification', 'PluginVersion')
    for official in OFFICIAL_PLUGINS:
        plugin = Plugin.objects.create(
            slug=official['slug'],
            name=official['name'],
            description=official['description'],
            author_name='Brainrot Index',
            default_threshold=official['default_threshold'],
            suggested_for_children=official['suggested_for_children'],
        )
        PluginVersion.objects.create(
            plugin=plugin,
            version=1,
            rubric_prompt=official['rubric_prompt'],
            allowed_labels=official['allowed_labels'],
        )


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0006_plugin_store_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='plugin',
            name='suggested_for_children',
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(create_official_plugins, migrations.RunPython.noop),
    ]
