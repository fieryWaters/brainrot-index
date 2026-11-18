"""The default filters become three conservative, criteria-scored ones: Rude
or Toxic, Low Effort, and Brainrot (version 3). See docs/FILTER_PRINCIPLES.md.

Each rubric states what the content is, and its criteria are yes-or-no
questions about the post. The model answers only the questions; the score is
the sum of the points of the criteria met (classification.scoring), kept
within 0 to 100. Every rubric has a fault that defines it (50 points),
supporting faults (30 each), and virtues that cancel the defining fault
(-50): substance for brainrot, adding something or joking for low effort, and
joking for rude or toxic. At the default threshold of 60 a post is filtered
only when it shows the defining fault and a supporting one, and none of the
virtues.

Engagement bait, ragebait, and AI slop stop being defaults. They stay in the
store, and every account that has them installed keeps them.

Brainrot's threshold moves from 40 to 60 for every installation still on the
old default, since 40 on the new scale is less than the defining criterion alone.

A rubric is frozen once released: to change one, add a new PluginVersion in a
new migration instead of editing the text here.
"""

from django.db import migrations

RUDE_OR_TOXIC_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is RUDE OR TOXIC.

Rude or toxic content is written to hurt, demean, or pour contempt on people,
rather than to inform, discuss, or amuse. Disagreement, criticism, bad news,
and strong opinions are not toxic in themselves. Humor is not policed: a joke,
even an edgy one, is not an attack when it is plainly meant as a joke. The same
standard applies to every side of every topic: judge how the post treats
people, never which view it holds."""

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
        'name': 'plainly_a_joke',
        'question': "The post is plainly a joke: a typical reader would take it as humor first, not as an attack.",
        'points': -50,
    },
]

LOW_EFFORT_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is ULTRA LOW EFFORT.

Ultra low effort content gives the reader nothing: it is inane, generic, or
mass-produced, the kind of thing bots and reply farms post by the thousand.
Its opposite is a post that brings a unique perspective, new information, a
real experience, or a sincere question, or explains something well. Short is
not the same as low effort: a sharp one-line joke or a precise answer has
effort in it."""

LOW_EFFORT_CRITERIA = [
    {
        'name': 'makes_no_point',
        'question': "The post is only a bare reaction (agreement, praise, 'wow', 'lol', emoji), "
                    "filler, or a restatement.",
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
        'question': "The post adds something of its own: information, an opinion with a reason, a real experience, "
                    "a sincere question, a joke, or a photo, video, or link worth a look.",
        'points': -50,
    },
]

BRAINROT_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You judge whether a post is BRAINROT.

Brainrot is empty-calorie content made for frictionless consumption: it holds
attention through stimulation (hype, shock, speed, trend formats, meme slang,
loud visuals) while giving the mind nothing to work on. The signal is high
engagement power with low information and low cognitive draw. One such post is
harmless; the harm is that each is made to be followed by the next. Content
that is engaging and also substantive, such as a story, a lesson, real news,
or skilled work, is not brainrot, and a post is not brainrot just for being
short, light, cute, or funny."""

BRAINROT_CRITERIA = [
    {
        'name': 'stimulation_is_the_point',
        'question': "The post holds attention mainly through stimulation: "
                    "hype or shock framing, rapid-fire or trend formats, meme slang, or sensory overload.",
        'points': 50,
    },
    {
        'name': 'made_for_the_next_one',
        'question': "It is one of an endless stream of interchangeable items, such as a short, "
                    "a compilation, a numbered part, or a trend repeat, made to be followed by the next.",
        'points': 30,
    },
    {
        'name': 'has_substance',
        'question': "The post gives the reader something real to take away: "
                    "information, news, a story, an idea, a skill, or craft.",
        'points': -50,
    },
]

NEW_DEFAULTS = [
    {
        'slug': 'rude-or-toxic',
        'name': 'Rude or Toxic',
        'description': 'Hides posts written to insult, demean, or pour contempt on people or groups. '
                       'Disagreement and jokes stay.',
        'rubric_prompt': RUDE_OR_TOXIC_RUBRIC,
        'criteria': RUDE_OR_TOXIC_CRITERIA,
    },
    {
        'slug': 'low-effort',
        'name': 'Low Effort',
        'description': 'Hides inane, generic, or mass-produced posts that give you nothing. '
                       'Short posts with a real point stay.',
        'rubric_prompt': LOW_EFFORT_RUBRIC,
        'criteria': LOW_EFFORT_CRITERIA,
    },
]
DEFAULT_THRESHOLD = 60
NO_LONGER_DEFAULT_SLUGS = ['engagement-bait', 'ragebait', 'ai-slop']
BRAINROT_PREVIOUS_DEFAULT_THRESHOLD = 40


def allowed_labels(criteria):
    """The label is the met criterion that adds the most points, or none."""
    return ['none'] + [criterion['name'] for criterion in criteria if criterion['points'] > 0]


def apply_conservative_defaults(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    PluginVersion = apps.get_model('classification', 'PluginVersion')
    UserPlugin = apps.get_model('classification', 'UserPlugin')

    for default in NEW_DEFAULTS:
        plugin = Plugin.objects.create(
            slug=default['slug'],
            name=default['name'],
            description=default['description'],
            author_name='BrainRot Index',
            is_baseline=True,
            default_threshold=DEFAULT_THRESHOLD,
        )
        PluginVersion.objects.create(
            plugin=plugin,
            version=1,
            rubric_prompt=default['rubric_prompt'],
            allowed_labels=allowed_labels(default['criteria']),
            criteria=default['criteria'],
        )

    brainrot = Plugin.objects.get(slug='brainrot')
    PluginVersion.objects.create(
        plugin=brainrot,
        version=3,
        rubric_prompt=BRAINROT_RUBRIC,
        allowed_labels=allowed_labels(BRAINROT_CRITERIA),
        criteria=BRAINROT_CRITERIA,
    )
    brainrot.default_threshold = DEFAULT_THRESHOLD
    brainrot.save(update_fields=['default_threshold'])
    UserPlugin.objects.filter(
        plugin=brainrot,
        threshold=BRAINROT_PREVIOUS_DEFAULT_THRESHOLD,
    ).update(threshold=DEFAULT_THRESHOLD)

    Plugin.objects.filter(slug__in=NO_LONGER_DEFAULT_SLUGS).update(is_baseline=False, author_name='BrainRot Index')


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0012_criteria_scoring'),
    ]

    operations = [
        migrations.RunPython(apply_conservative_defaults, migrations.RunPython.noop),
    ]
