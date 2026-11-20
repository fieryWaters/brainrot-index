"""New rubric versions for Low Effort and Rude or Toxic, and Engagement Bait
back as a default, rewritten on the point system. See docs/FILTER_PRINCIPLES.md.

Low Effort (version 2) judges a reply by what it adds to the post it replies
to. A short reply that answers a question or responds to what was said adds
something in that context.

Rude or Toxic (version 2) judges a post by the response it draws from a
typical reader: anger, hurt, or feeling put down, versus a laugh. A joke that
makes people laugh is not toxic, even an edgy one.

Engagement Bait (version 3) is scored by criteria like the other defaults: a
post built to provoke replies or reactions rather than to give the reader
something. It is installed for new accounts again; accounts that removed it
are not changed.

Scores follow the other defaults: a defining fault of 50, supporting faults of
30, virtues of -50, filtered at the default threshold of 60.

A rubric is frozen once released: to change one, add a new PluginVersion in a
new migration instead of editing the text here.
"""

from django.db import migrations

LOW_EFFORT_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is ULTRA LOW EFFORT.

Ultra low effort content gives the reader nothing: it is inane, generic, or
mass-produced, the kind of thing bots and reply farms post by the thousand.
Its opposite is a post that brings a unique perspective, new information, a
real experience, or a sincere question, or explains something well.

A reply is part of a conversation, so judge it by what it adds to the post it
replies to, not as if it stood alone. A short reply that answers a question or
responds to what was said can carry real information in that context; a
reply that would fit under any post carries none. Short is not the same as
low effort: a sharp one-line joke or a precise answer has effort in it."""

LOW_EFFORT_CRITERIA = [
    {
        'name': 'makes_no_point',
        'question': "Read with what it replies to, the post is only a bare reaction "
                    "(agreement, praise, 'wow', 'lol', emoji), filler, or a restatement.",
        'points': 50,
    },
    {
        'name': 'fits_anywhere',
        'question': "The same words would make just as much sense under an unrelated post.",
        'points': 30,
    },
    {
        'name': 'bot_like',
        'question': "The post reads as written by a bot or an assistant: template phrasing, "
                    "a flattering restatement, or a pitch tacked on.",
        'points': 30,
    },
    {
        'name': 'plainly_a_joke',
        'question': "The post is plainly a joke: a typical reader would take it as humor first.",
        'points': -50,
    },
    {
        'name': 'adds_something',
        'question': "Read with what it replies to, the post tells the reader something of its own: "
                    "information, an answer to a question asked, a response to the particular thing said, "
                    "an opinion with a reason, a real experience, a sincere question, a joke, "
                    "or a photo, video, or link worth a look.",
        'points': -50,
    },
]

RUDE_OR_TOXIC_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is RUDE OR TOXIC.

Rude or toxic content is written to hurt, demean, or pour contempt on people.
What matters is the response it draws from a typical reader: a toxic post
leaves them angry, hurt, or put down, while a funny one makes them laugh or
chuckle. Those are very different reactions, and humor is not policed: a joke,
even an edgy one or one at someone's expense, is not toxic when people would
laugh at it. Disagreement, criticism, bad news, and strong opinions are not
toxic in themselves. The same standard applies to every side of every topic:
judge how the post treats people, never which view it holds."""

RUDE_OR_TOXIC_CRITERIA = [
    {
        'name': 'demeans_people',
        'question': "The author, in their own words, insults, mocks, or scorns a person or a group of people: "
                    "name-calling, slurs, dehumanizing language, or contempt for a whole group. "
                    "Reporting or quoting someone else's words does not count.",
        'points': 50,
    },
    {
        'name': 'us_against_them',
        'question': "The post casts a group or side as an enemy to resent "
                    "(a party, nation, religion, gender, generation, fandom, or the users of a product).",
        'points': 30,
    },
    {
        'name': 'hostile_tone',
        'question': "The author's own tone is hostile: they sneer, curse, or rage at someone.",
        'points': 30,
    },
    {
        'name': 'makes_readers_laugh',
        'question': "The post is humor: a typical reader would laugh or chuckle at it rather than feel "
                    "angry or hurt, even if the joke is dark, edgy, or at someone's expense.",
        'points': -50,
    },
]

ENGAGEMENT_BAIT_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is ENGAGEMENT BAIT.

Engagement bait is built to provoke replies or reactions rather than to give
the reader something. Its content is the response it asks for: a question,
poll, challenge, or contest put up for the crowd, or a call to comment, like,
share, or tag, with little of its own for someone who only reads it. A post
that says something, such as information, news, an idea, an opinion, a joke,
or a sincere question the author wants answered, is not bait just because
people will reply to it or argue with it. Anger and contempt are judged by
other filters, not this one."""

ENGAGEMENT_BAIT_CRITERIA = [
    {
        'name': 'built_for_replies',
        'question': "The post exists mainly to collect replies, votes, shares, or tags: "
                    "what it asks of readers matters more than anything it says.",
        'points': 50,
    },
    {
        'name': 'asks_for_reactions',
        'question': "The post asks or dares readers to react: to comment, like, share, tag, follow, "
                    "pick a side, or answer a prompt.",
        'points': 30,
    },
    {
        'name': 'answers_are_the_content',
        'question': "The post is a prompt whose answers are the real content: a would-you-rather, a poll, "
                    "a fill-in-the-blank, a contest, or a story put up for readers to judge.",
        'points': 30,
    },
    {
        'name': 'says_something',
        'question': "The post says something to a reader who never replies: information, news, an idea, "
                    "an opinion, a joke, or a sincere question seeking help or facts.",
        'points': -50,
    },
]
ENGAGEMENT_BAIT_DESCRIPTION = ('Hides posts built to draw replies, votes, and shares rather than to give you '
                               'something. Sincere questions stay.')

NEW_VERSIONS = [
    ('low-effort', 2, LOW_EFFORT_RUBRIC, LOW_EFFORT_CRITERIA),
    ('rude-or-toxic', 2, RUDE_OR_TOXIC_RUBRIC, RUDE_OR_TOXIC_CRITERIA),
    ('engagement-bait', 3, ENGAGEMENT_BAIT_RUBRIC, ENGAGEMENT_BAIT_CRITERIA),
]
DEFAULT_THRESHOLD = 60


def allowed_labels(criteria):
    """The label is the met criterion that adds the most points, or none."""
    return ['none'] + [criterion['name'] for criterion in criteria if criterion['points'] > 0]


def add_versions_and_default(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    PluginVersion = apps.get_model('classification', 'PluginVersion')

    for slug, version, rubric_prompt, criteria in NEW_VERSIONS:
        PluginVersion.objects.create(
            plugin=Plugin.objects.get(slug=slug),
            version=version,
            rubric_prompt=rubric_prompt,
            allowed_labels=allowed_labels(criteria),
            criteria=criteria,
        )

    Plugin.objects.filter(slug='engagement-bait').update(
        is_baseline=True,
        description=ENGAGEMENT_BAIT_DESCRIPTION,
        default_threshold=DEFAULT_THRESHOLD,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0017_postjudgment_kept_after_account_deletion'),
    ]

    operations = [
        migrations.RunPython(add_versions_and_default, migrations.RunPython.noop),
    ]
