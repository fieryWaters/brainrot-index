"""Talking to Stripe: the one product and price, and copying a Stripe
subscription's state onto the account's Subscription row."""

from datetime import datetime, timezone as dt_timezone

import stripe
from django.conf import settings

from .models import STATUS_ACTIVE, STATUS_CANCELED, STATUS_NONE, STATUS_PAST_DUE, STATUS_TRIALING, Subscription

PRODUCT_NAME = 'Brainrot Index'
PRICE_LOOKUP_KEY = 'brainrot_index_monthly'
PRICE_CENTS = 500

# Tags the Customer Portal configuration this site creates, since the Stripe
# account is shared with another site.
PORTAL_CONFIGURATION_SITE = 'brainrot_index'

# Stripe's subscription statuses mapped onto ours. unpaid and paused mean
# Stripe has stopped collecting, so they grant no access.
STATUS_FROM_STRIPE = {
    'trialing': STATUS_TRIALING,
    'active': STATUS_ACTIVE,
    'past_due': STATUS_PAST_DUE,
    'unpaid': STATUS_CANCELED,
    'paused': STATUS_CANCELED,
    'canceled': STATUS_CANCELED,
    'incomplete_expired': STATUS_CANCELED,
    'incomplete': STATUS_NONE,
}


def stripe_client():
    return stripe.StripeClient(settings.STRIPE_SECRET_KEY)


def monthly_price():
    """The $5/month price, or None before setup_stripe has run."""
    prices = stripe_client().v1.prices.list({'lookup_keys': [PRICE_LOOKUP_KEY], 'active': True, 'limit': 1})
    if not prices['data']:
        return None
    return prices['data'][0]


def portal_configuration_id():
    """The id of this site's Customer Portal configuration, made by setup_stripe."""
    configurations = stripe_client().v1.billing_portal.configurations.list({'active': True, 'limit': 100})
    for configuration in configurations['data']:
        metadata = configuration['metadata']
        if 'site' in metadata and metadata['site'] == PORTAL_CONFIGURATION_SITE:
            return configuration['id']
    return None


def from_unix(timestamp):
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, tz=dt_timezone.utc)


def apply_stripe_subscription(subscription, stripe_subscription):
    """Copies a Stripe subscription object onto our Subscription row."""
    # The billing period lives on the subscription's item; there is one item, the monthly price.
    first_item = stripe_subscription['items']['data'][0]

    # The Customer Portal schedules a cancellation either with cancel_at_period_end
    # or by setting cancel_at, depending on the API version.
    scheduled_to_cancel = stripe_subscription['cancel_at_period_end'] or stripe_subscription['cancel_at'] is not None

    subscription.status = STATUS_FROM_STRIPE.get(stripe_subscription['status'], STATUS_NONE)
    subscription.stripe_subscription_id = stripe_subscription['id']
    subscription.current_period_end = from_unix(first_item['current_period_end'])
    subscription.cancel_at_period_end = scheduled_to_cancel and subscription.status != STATUS_CANCELED
    subscription.save()


def refresh_subscription(stripe_subscription_id):
    """Fetches a subscription from Stripe and updates the account it belongs to.
    Answers the updated Subscription, or None when the Stripe customer is not
    one of ours (the Stripe account is shared with another site)."""
    stripe_subscription = stripe_client().v1.subscriptions.retrieve(stripe_subscription_id)
    subscription = Subscription.objects.filter(stripe_customer_id=stripe_subscription['customer']).first()
    if subscription is None:
        return None
    apply_stripe_subscription(subscription, stripe_subscription)
    return subscription
