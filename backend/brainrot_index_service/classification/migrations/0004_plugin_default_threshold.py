"""Gives each plugin the threshold new users start with, chosen from the
evaluation's threshold sweep of rubric version 2 on the local model
(eval/README.md). Installed plugins still on the old default of 60 move to the
new default; a threshold the user changed stays.

Ragebait drops to 40: at 60 the model caught 63% of ragebait while wrongly
flagging 1%; at 40 it catches 86% while wrongly flagging 6%. The other plugins
stay at 60, where they already balance missed and wrongly flagged posts."""

import django.core.validators
from django.db import migrations, models

OLD_DEFAULT_THRESHOLD = 60
DEFAULT_THRESHOLDS = {
    'engagement-bait': 60,
    'ragebait': 40,
    'brainrot': 60,
    'ai-slop': 60,
}


def apply_default_thresholds(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    UserPlugin = apps.get_model('classification', 'UserPlugin')
    for slug, default_threshold in DEFAULT_THRESHOLDS.items():
        Plugin.objects.filter(slug=slug).update(default_threshold=default_threshold)
        UserPlugin.objects.filter(plugin__slug=slug, threshold=OLD_DEFAULT_THRESHOLD).update(threshold=default_threshold)


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0003_rubrics_version_2'),
    ]

    operations = [
        migrations.AddField(
            model_name='plugin',
            name='default_threshold',
            field=models.PositiveSmallIntegerField(
                default=60,
                validators=[
                    django.core.validators.MinValueValidator(0),
                    django.core.validators.MaxValueValidator(100),
                ],
            ),
        ),
        migrations.RunPython(apply_default_thresholds, migrations.RunPython.noop),
    ]
