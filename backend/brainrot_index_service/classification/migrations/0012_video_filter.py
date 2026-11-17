"""Video filters, which watch the video in a post, frames and audio, instead
of reading its text: a plugin's input_kind, the post's video (PostVideo), the
not_applicable status for a video filter meeting a post without a video, and
the first video filter, Brainrot video.

Brainrot video is unlisted while it is a prototype: it is added to an account
in the admin. Its score is computed in classification.video_judging from the
three criterion scores the model gives.

A rubric is frozen once released: to change one, add a new PluginVersion in a
new migration instead of editing the text here.
"""

import django.db.models.deletion
from django.db import migrations, models


VIDEO_BRAINROT_RUBRIC = """\
You are a content classifier for Brainrot Index, a browser extension that
filters social media feeds. You watch and listen to a video and judge whether
it is BRAINROT.

Brainrot is video with high engagement power, low information content and low
cognitive draw: built to hold attention while giving little back, so that it
can be watched thirty in a row without any friction. Judge what you see and
hear, not the topic. Video that is cute, funny or beautiful is not brainrot
for that alone.

Score each of three criteria from 0 to 5.

ENGAGEMENT POWER: how hard the form works to hold attention, apart from what
is said or shown. Fast cuts, constant motion, saturated or flashing visuals,
relentless sound design, fast talking and hooks raise it.
0: calm and plain. 5: every second is built to grab attention.

INFORMATION CONTENT: how much the viewer learns or gains: facts, ideas, skill,
a real story, real craft, a real joke.
0: nothing. 5: dense and substantive.

COGNITIVE DRAW: how much sustained attention and thought the video asks for.
0: it can be watched half asleep. 5: it asks the viewer to follow and think.

You may be shown only the opening of a longer video; judge what you are shown."""


def create_video_brainrot_plugin(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    PluginVersion = apps.get_model('classification', 'PluginVersion')
    plugin = Plugin.objects.create(
        slug='video-brainrot',
        name='Brainrot video',
        description=(
            'Watches and listens to videos on YouTube, Reddit and X, and catches the ones built to '
            'hold attention while giving little back.'
        ),
        author_name='Brainrot Index',
        is_listed=False,
        # 10 of 15 points: see classification.video_judging.
        default_threshold=67,
        input_kind='video',
    )
    PluginVersion.objects.create(
        plugin=plugin,
        version=1,
        rubric_prompt=VIDEO_BRAINROT_RUBRIC,
        allowed_labels=['not_brainrot', 'brainrot'],
    )


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0011_postjudgment'),
    ]

    operations = [
        migrations.AddField(
            model_name='plugin',
            name='input_kind',
            field=models.CharField(choices=[('post', 'Post'), ('video', 'Video')], default='post', max_length=16),
        ),
        migrations.AlterField(
            model_name='classification',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending', 'Pending'),
                    ('done', 'Done'),
                    ('failed', 'Failed'),
                    ('not_applicable', 'Not applicable'),
                ],
                default='pending',
                max_length=16,
            ),
        ),
        migrations.CreateModel(
            name='PostVideo',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(
                    choices=[('pending', 'Pending'), ('ready', 'Ready'), ('missing', 'Missing')],
                    default='pending',
                    max_length=16,
                )),
                ('source_url', models.TextField()),
                ('duration_seconds', models.PositiveIntegerField(blank=True, null=True)),
                ('clip', models.FileField(blank=True, upload_to='post_videos/%Y/%m/')),
                ('clip_seconds', models.FloatField(blank=True, null=True)),
                ('clip_bytes', models.PositiveIntegerField(blank=True, null=True)),
                ('missing_reason', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('settled_at', models.DateTimeField(blank=True, null=True)),
                ('post', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='video',
                    to='classification.post',
                )),
            ],
            options={
                'indexes': [
                    models.Index(
                        condition=models.Q(('status', 'pending')),
                        fields=['id'],
                        name='pending_post_videos',
                    ),
                ],
            },
        ),
        migrations.RunPython(create_video_brainrot_plugin, migrations.RunPython.noop),
    ]
