"""Accounts made before billing existed start their 7-day trial now."""

from datetime import timedelta

from django.conf import settings
from django.db import migrations
from django.utils import timezone

TRIAL_DAYS = 7


def start_trials(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split('.'))
    Subscription = apps.get_model('billing', 'Subscription')
    trial_end = timezone.now() + timedelta(days=TRIAL_DAYS)
    Subscription.objects.bulk_create([
        Subscription(user=user, status='trialing', trial_end=trial_end)
        for user in User.objects.filter(subscription__isnull=True)
    ])


class Migration(migrations.Migration):

    dependencies = [
        ('billing', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(start_trials, migrations.RunPython.noop),
    ]
