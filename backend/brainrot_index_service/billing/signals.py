"""Every new account starts a free trial the moment it is created."""

from datetime import timedelta

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from .models import STATUS_TRIALING, Subscription

TRIAL_DAYS = 7


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def start_trial_for_new_account(sender, instance, created, **kwargs):
    if not created:
        return
    Subscription.objects.create(
        user=instance,
        status=STATUS_TRIALING,
        trial_end=timezone.now() + timedelta(days=TRIAL_DAYS),
    )
