"""Brainrot is one filter: it judges everything in a post, and watches the
post's video when it has one that can be watched, with the same rubric,
criteria and score (classification.video_judging). A post without a video,
or whose video cannot be watched, is judged as before.

The Brainrot video prototype is retired. Accounts that installed it keep it,
turned off and unlisted, so nobody's feed calls it; its rubric, versions and
classifications are kept."""

from django.db import migrations

BRAINROT_SLUG = 'brainrot'
VIDEO_BRAINROT_SLUG = 'video-brainrot'


def make_brainrot_watch_videos(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    UserPlugin = apps.get_model('classification', 'UserPlugin')
    Plugin.objects.filter(slug=BRAINROT_SLUG).update(input_kind='video')
    Plugin.objects.filter(slug=VIDEO_BRAINROT_SLUG).update(is_listed=False)
    UserPlugin.objects.filter(plugin__slug=VIDEO_BRAINROT_SLUG).update(enabled=False)


# Brainrot video installs stay off: which ones were on before is not recorded.
def make_brainrot_read_only_posts(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    Plugin.objects.filter(slug=BRAINROT_SLUG).update(input_kind='post')


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0018_rubrics_version_3'),
    ]

    operations = [
        migrations.RunPython(make_brainrot_watch_videos, make_brainrot_read_only_posts),
    ]
