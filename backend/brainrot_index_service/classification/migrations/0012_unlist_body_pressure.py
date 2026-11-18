"""Takes the official Body Pressure plugin out of the store. Accounts that
installed it keep it, turned off, so their feeds stop calling it but their
threshold and blur or hide choice are still there. Its rubric, versions and
classifications are kept."""

from django.db import migrations

SLUG = 'body-pressure'


def unlist_and_turn_off(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    UserPlugin = apps.get_model('classification', 'UserPlugin')
    Plugin.objects.filter(slug=SLUG).update(is_listed=False)
    UserPlugin.objects.filter(plugin__slug=SLUG).update(enabled=False)


# Installs stay off: which ones were on before is not recorded.
def relist(apps, schema_editor):
    Plugin = apps.get_model('classification', 'Plugin')
    Plugin.objects.filter(slug=SLUG).update(is_listed=True)


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0011_postjudgment'),
    ]

    operations = [
        migrations.RunPython(unlist_and_turn_off, relist),
    ]
