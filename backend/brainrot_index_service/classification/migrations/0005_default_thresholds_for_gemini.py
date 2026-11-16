"""Default thresholds for google/gemini-2.5-flash-lite, the hosted model,
chosen from the evaluation's threshold sweep of rubric version 2
(eval/results/). Installed plugins still on the previous default move to the
new one; a threshold the user changed stays.

At the new defaults, on the evaluation dataset:
- brainrot 40: catches 65% (59% at 60) and wrongly flags 2 posts instead of 1.
- AI slop 30: catches every case (83% at 60) and wrongly flags 6 instead of 4.
Engagement bait stays at 60 and ragebait at 40, already the best balance."""

from django.db import migrations

PREVIOUS_DEFAULT_THRESHOLDS = {
    'engagement-bait': 60,
    'ragebait': 40,
    'brainrot': 60,
    'ai-slop': 60,
}
DEFAULT_THRESHOLDS = {
    'engagement-bait': 60,
    'ragebait': 40,
    'brainrot': 40,
    'ai-slop': 30,
}


def apply_default_thresholds(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    UserPlugin = apps.get_model('classification', 'UserPlugin')
    for slug, default_threshold in DEFAULT_THRESHOLDS.items():
        Plugin.objects.filter(slug=slug).update(default_threshold=default_threshold)
        UserPlugin.objects.filter(
            plugin__slug=slug,
            threshold=PREVIOUS_DEFAULT_THRESHOLDS[slug],
        ).update(threshold=default_threshold)


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0004_plugin_default_threshold'),
    ]

    operations = [
        migrations.RunPython(apply_default_thresholds, migrations.RunPython.noop),
    ]
