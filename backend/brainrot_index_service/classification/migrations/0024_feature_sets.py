"""Feature sets: filters as formulas over a few features the model scores in
one call per post. Version 1 holds the starting definitions, to be measured
on the tuning page; live filtering does not use it."""

from django.db import migrations, models
import django.db.models.deletion


def level(text, example):
    return {'text': text, 'examples': [example]}


FEATURES = [
    {
        'name': 'pull',
        'description': 'How much the post holds attention through stimulation rather than through what it means.',
        'levels': [
            level('Calm or plain. Nothing in it tries to grab attention.',
                  'A text post saying the town library now stays open until 8pm on Thursdays.'),
            level('Some hooks, paced so a reader can follow: a catchy title, music, ordinary editing.',
                  'A cooking video titled "The easiest bread you will ever bake", with soft music and a cut '
                  'between each step.'),
            level('Driven by hooks: hype or shock framing, a trend format, quick cuts.',
                  'A clip captioned "You will NOT believe what this $5 gadget does", cutting every two seconds.'),
            level('Stimulation without a pause: rapid cuts, loud saturated visuals, captions popping up word '
                  'by word, sound effects, a short clip made to be swiped past to the next.',
                  'Twelve seconds of neon slime being sliced, a whoosh on every cut, one flashing word of '
                  'caption at a time.'),
        ],
    },
    {
        'name': 'emptiness',
        'description': 'What a reader is left with afterwards. For a reply, what it adds to its conversation.',
        'levels': [
            level('Substantial: it teaches, brings new information or a new perspective, tells a real story, '
                  'reports news, shows skilled work, or explains something well.',
                  'A reply explaining why the bridge in the photo hangs from cables instead of resting on '
                  'arches, given the width of the river.'),
            level('A real contribution, even if short: an answer, an experience, a sincere question, a joke '
                  'that lands, a reaction with a reason.',
                  'A reply: "I had the same error, and going back to version 2.3 fixed it."'),
            level('Thin: a generic opinion anyone could post, or one fact or gag stretched out.',
                  'A reply: "Honestly so true, more people need to hear this."'),
            level('Nothing: a bare reaction such as "lol" or an emoji, filler, template text that could sit '
                  'under any post, or spectacle with nothing to take away.',
                  'A reply made of three fire emoji.'),
        ],
    },
    {
        'name': 'reply_hook',
        'description': 'How much the post is built to pull replies out of its readers.',
        'levels': [
            level('Asks nothing of the reader.',
                  '"Finished the first draft of my novel today."'),
            level('An ordinary question or invitation that follows from what it says.',
                  '"Just moved to Denver. Any good hikes within an hour of the city?"'),
            level('The ask is the point: a poll, a would-you-rather, "agree?", tag a friend, a story put up '
                  'for readers to judge.',
                  '"Pizza or tacos for the rest of your life? Comment below."'),
            level('Built to itch: a question with an obvious answer, a deliberate mistake to correct, a dare, '
                  '"only 1% get this right".',
                  '"Only geniuses solve this: 8 / 2(2 + 2) = ?"'),
        ],
    },
    {
        'name': 'hostility',
        'description': 'Hostility the post delivers to its reader, in its own words or in the screenshots and '
                       'quotes it shows. Rate the language, never the position taken.',
        'levels': [
            level('None: disagreement, criticism or bad news in plain words.',
                  '"I think this policy will raise rents, and here is why."'),
            level('An edge: sarcasm, a pointed jab, dismissiveness.',
                  '"Wow, another genius take. Groundbreaking."'),
            level('Hostile: insults, scorn, mockery of a person or a group.',
                  '"Anyone who still buys these is an idiot."'),
            level('Vicious: slurs, dehumanizing language, abuse, rage, threats.',
                  '"People like you are vermin and deserve what is coming."'),
        ],
    },
    {
        'name': 'humor',
        'description': 'Whether a typical reader would laugh rather than be hurt.',
        'levels': [
            level('Not a joke.',
                  '"The meeting moved to Thursday."'),
            level('A joking tone, but the sting lands more than the laugh.',
                  '"Imagine being this ugly and still posting selfies, lol."'),
            level('Most readers would laugh or chuckle.',
                  '"My cat knocked my coffee off the table, looked me in the eye, then knocked off the spoon '
                  'too."'),
        ],
    },
]

FILTERS = [
    {'plugin': 'brainrot', 'form': 'product', 'features': ['pull', 'emptiness'], 'cutoff': 50},
    {'plugin': 'engagement-bait', 'form': 'product', 'features': ['reply_hook', 'emptiness'], 'cutoff': 50},
    {'plugin': 'low-effort', 'form': 'weighted_sum', 'weights': {'emptiness': 10}, 'cutoff': 80},
    {'plugin': 'rude-or-toxic', 'form': 'weighted_sum', 'weights': {'hostility': 10, 'humor': -6}, 'cutoff': 60},
]


def add_first_feature_set(apps, schema_editor):
    FeatureSet = apps.get_model('classification', 'FeatureSet')
    FeatureSet.objects.create(version=1, features=FEATURES, filters=FILTERS)


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0023_judgment_label'),
    ]

    operations = [
        migrations.CreateModel(
            name='FeatureSet',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version', models.PositiveIntegerField(unique=True)),
                ('features', models.JSONField()),
                ('filters', models.JSONField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.CreateModel(
            name='PostFeatureScores',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('done', 'Done'), ('failed', 'Failed'), ('not_applicable', 'Not applicable')], default='pending', max_length=16)),
                ('scores', models.JSONField(blank=True, default=dict)),
                ('prompt', models.JSONField(blank=True, null=True)),
                ('raw_response', models.TextField(blank=True, default='')),
                ('model', models.CharField(blank=True, default='', max_length=200)),
                ('inference_source', models.CharField(blank=True, default='', max_length=32)),
                ('prompt_tokens', models.PositiveIntegerField(blank=True, null=True)),
                ('cached_prompt_tokens', models.PositiveIntegerField(blank=True, null=True)),
                ('completion_tokens', models.PositiveIntegerField(blank=True, null=True)),
                ('latency_ms', models.PositiveIntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('feature_set', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='post_scores', to='classification.featureset')),
                ('post', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='feature_scores', to='classification.post')),
            ],
            options={
                'verbose_name_plural': 'post feature scores',
                'indexes': [models.Index(condition=models.Q(('status', 'pending')), fields=['id'], name='pending_feature_scores')],
                'constraints': [models.UniqueConstraint(fields=('post', 'feature_set'), name='unique_feature_scores')],
            },
        ),
        migrations.RunPython(add_first_feature_set, migrations.RunPython.noop),
    ]
