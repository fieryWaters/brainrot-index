from django.conf import settings
from django.db import models


STATUS_TRIALING = 'trialing'
STATUS_ACTIVE = 'active'
STATUS_PAST_DUE = 'past_due'
STATUS_CANCELED = 'canceled'
STATUS_NONE = 'none'
STATUS_CHOICES = [
    (STATUS_TRIALING, 'Trialing'),
    (STATUS_ACTIVE, 'Active'),
    (STATUS_PAST_DUE, 'Past due'),
    (STATUS_CANCELED, 'Canceled'),
    (STATUS_NONE, 'None'),
]


class Subscription(models.Model):
    """An account's right to use filtering: a free trial, a paid Stripe
    subscription, or comp (free forever).

    Without a Stripe subscription, status is trialing until trial_end. With
    one, status, current_period_end and cancel_at_period_end mirror Stripe.
    """

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='subscription')
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_NONE)
    trial_end = models.DateTimeField(null=True, blank=True)
    current_period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)
    comp = models.BooleanField(default=False, help_text='Free forever, never asked to pay.')
    stripe_customer_id = models.CharField(max_length=64, blank=True, default='', db_index=True)
    stripe_subscription_id = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"subscription of {self.user} ({self.status})"


class StripeEvent(models.Model):
    """A webhook event already handled, so a redelivered event is ignored."""

    event_id = models.CharField(max_length=255, unique=True)
    event_type = models.CharField(max_length=100)
    received_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.event_type} {self.event_id}"
