"""Low Effort version 3 and Rude or Toxic version 3. See
docs/FILTER_PRINCIPLES.md.

Low Effort judges whether a reply does its job in its conversation, not
whether it would fit under another post. A reply from the author of the
thread's post is part of their own conversation: thanking or updating the
people who helped moves it along.

Rude or Toxic judges the hostility a post delivers to the reader, whoever
first said it: screenshots of someone else's abuse count. It judges the
language, never the position, so the same words aimed at any other group
score the same, and a joke people would laugh at delivers a laugh, not
hostility.

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

A reply is part of a conversation, so judge whether it does its job in that
conversation, not whether its words would fit somewhere else. A short answer,
a thank-you to the people who helped, or an update from the person who asked
all move a conversation along, and a reply from the author of the thread's
post is always part of their own conversation. Short is not the same as low effort: a sharp
one-line joke or a precise answer has effort in it."""

LOW_EFFORT_CRITERIA = [
    {
        'name': 'makes_no_point',
        'question': "Read in its conversation, the post does nothing there: it is a bare reaction "
                    "(praise, 'wow', 'lol', emoji), filler, or a restatement.",
        'points': 50,
    },
    {
        'name': 'crowd_noise',
        'question': "It speaks to no one in particular and takes no real turn in any conversation: "
                    "the kind of filler or outburst that bots and reply farms post by the thousand.",
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
        'name': 'does_its_job',
        'question': "Read in its conversation, the post does a real job there: it informs, answers, "
                    "asks sincerely, jokes, shares an experience, opinion, photo, or link worth a look, "
                    "or thanks or updates the people it is talking with.",
        'points': -50,
    },
]

RUDE_OR_TOXIC_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is RUDE OR TOXIC.

Rude or toxic content delivers hostility or contempt to the reader: insults,
scorn, threats, or rage. The test is the reader's response: a toxic post
leaves them angry, stressed, or put down, while a funny one makes them laugh. What
counts is what the post puts in front of the reader, whoever first said it:
screenshots or quotes of someone else's abuse deliver it just the same.
Humor is not policed: a joke delivers a laugh, not hostility, so a post most
readers would laugh at is not toxic, even when the joke is dark, crude, or at
someone's expense. Disagreement, criticism, bad news, and strong opinions are
not toxic in themselves. Judge the language, never the position: the same
words aimed at any other group or side would score the same."""

RUDE_OR_TOXIC_CRITERIA = [
    {
        'name': 'delivers_hostility',
        'question': "The post puts hostility or contempt in front of the reader that would leave them angry, "
                    "stressed, or put down, in the author's own words or in someone else's words that the post "
                    "shows, such as screenshots or quotes.",
        'points': 50,
    },
    {
        'name': 'contempt_for_people',
        'question': "The language scorns or dehumanizes a person or a group: insults, slurs, mockery, "
                    "or vile motives pinned on them.",
        'points': 30,
    },
    {
        'name': 'raw_hostility',
        'question': "The hostility is raw: cursing, raging, threatening, or abusing someone.",
        'points': 30,
    },
    {
        'name': 'makes_readers_laugh',
        'question': "The post is humor: a typical reader would laugh or chuckle at it rather than feel "
                    "angry or hurt, even if the joke is dark, edgy, or at someone's expense.",
        'points': -50,
    },
]

NEW_VERSIONS = [
    ('low-effort', 3, LOW_EFFORT_RUBRIC, LOW_EFFORT_CRITERIA),
    ('rude-or-toxic', 3, RUDE_OR_TOXIC_RUBRIC, RUDE_OR_TOXIC_CRITERIA),
]


def allowed_labels(criteria):
    """The label is the met criterion that adds the most points, or none."""
    return ['none'] + [criterion['name'] for criterion in criteria if criterion['points'] > 0]


def add_versions(apps, schema_editor):
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


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0021_judgment_no_filter_covers'),
    ]

    operations = [
        migrations.RunPython(add_versions, migrations.RunPython.noop),
    ]
