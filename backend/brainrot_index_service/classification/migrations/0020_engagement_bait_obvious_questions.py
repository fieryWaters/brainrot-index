"""Engagement Bait version 4: a question whose answer is obvious is bait. See
"Questions with an obvious answer" in docs/FILTER_PRINCIPLES.md.

Such a question asks for nothing a reader could actually give. It draws
replies by provoking the urge to correct the record, a strong "obviously not"
reaction close to rage bait. Version 4 adds that as a supporting fault, and a
question with an obvious answer no longer counts as a sincere question.

A rubric is frozen once released: to change one, add a new PluginVersion in a
new migration instead of editing the text here.
"""

from django.db import migrations

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
other filters, not this one.

A question whose answer is obvious is bait however sincere it sounds: no
reader can help with it, and it draws replies by provoking the urge to correct
the record, a strong "obviously not" reaction."""

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
        'name': 'answer_is_obvious',
        'question': "The post asks a question that the facts it gives already answer, "
                    "so almost every reader would give the same answer at once.",
        'points': 30,
    },
    {
        'name': 'says_something',
        'question': "The post says something to a reader who never replies: information, news, an idea, "
                    "an opinion, a joke, or a question readers could actually help with because its answer is not obvious.",
        'points': -50,
    },
]


def allowed_labels(criteria):
    """The label is the met criterion that adds the most points, or none."""
    return ['none'] + [criterion['name'] for criterion in criteria if criterion['points'] > 0]


def add_version_4(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    PluginVersion = apps.get_model('classification', 'PluginVersion')
    PluginVersion.objects.create(
        plugin=Plugin.objects.get(slug='engagement-bait'),
        version=4,
        rubric_prompt=ENGAGEMENT_BAIT_RUBRIC,
        allowed_labels=allowed_labels(ENGAGEMENT_BAIT_CRITERIA),
        criteria=ENGAGEMENT_BAIT_CRITERIA,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0019_one_brainrot'),
    ]

    operations = [
        migrations.RunPython(add_version_4, migrations.RunPython.noop),
    ]
