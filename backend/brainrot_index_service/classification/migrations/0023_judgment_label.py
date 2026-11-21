"""Each thumbs carries one label: should be shown, or should be blocked as one
filter (or as Other). Existing thumbs get the label their verdict says: up
keeps what the reader saw, down asks for the opposite. A thumbs down on a
hidden post named the filter that wrongly hid it; that filter stays in
filter_results, and the label names none. A post blocked as no filter is
blocked as Other, so no_filter_covers is no longer needed."""

from django.db import migrations, models


def label_existing_thumbs(apps, schema_editor):
    PostJudgment = apps.get_model('classification', 'PostJudgment')
    for judgment in PostJudgment.objects.all():
        shown = judgment.shown_action == 'allow'
        right = judgment.verdict == 'right'
        if right and shown:
            judgment.should_be = 'shown'
            judgment.plugin = None
        elif right:
            # The plugin is already the filter that hid it.
            judgment.should_be = 'blocked'
        elif not shown:
            judgment.should_be = 'shown'
            judgment.plugin = None
        else:
            # The plugin is the filter the reader named, or empty for Other.
            judgment.should_be = 'blocked'
        judgment.save(update_fields=['should_be', 'plugin'])


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0022_low_effort_in_conversation_rude_or_toxic_delivered'),
    ]

    operations = [
        migrations.AddField(
            model_name='postjudgment',
            name='should_be',
            field=models.CharField(choices=[('shown', 'Should be shown'), ('blocked', 'Should be blocked')],
                                   default='shown', max_length=16),
            preserve_default=False,
        ),
        migrations.RunPython(label_existing_thumbs, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='postjudgment',
            name='no_filter_covers',
        ),
    ]
