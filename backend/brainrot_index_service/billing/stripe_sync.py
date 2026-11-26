"""Talking to Stripe: the one product and price, and copying a Stripe
subscription's state onto the account's Subscription row."""

from datetime import datetime, timezone as dt_timezone

import stripe
from django.conf import settings
from django.utils import timezone

from .models import STATUS_ACTIVE, STATUS_CANCELED, STATUS_NONE, STATUS_PAST_DUE, STATUS_TRIALING, Subscription

PRODUCT_NAME = 'Brainrot Index'
# What card statements show for the charge.
STATEMENT_DESCRIPTOR = 'BRAINROT INDEX'
PRICE_LOOKUP_KEY = 'brainrot_index_monthly'
PRICE_CENTS = 499

# Tags the Customer Portal configuration this site creates, so it is found
# again even in a Stripe account shared with another site.
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
    """The monthly price holding the lookup key, or None before setup_stripe has run."""
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


def is_missing(error):
    """The Stripe object does not exist in the account the key belongs to, for
    example an id saved while the site used a different Stripe account."""
    return isinstance(error, stripe.InvalidRequestError) and error.code == 'resource_missing'


def forget_stripe_ids(subscription):
    """Drops Stripe ids that the current Stripe account does not know, so the
    account is treated as one that never subscribed: its trial still counts."""
    subscription.stripe_customer_id = ''
    subscription.stripe_subscription_id = ''
    subscription.current_period_end = None
    subscription.cancel_at_period_end = False
    if subscription.trial_end is not None and subscription.trial_end > timezone.now():
        subscription.status = STATUS_TRIALING
    else:
        subscription.status = STATUS_NONE
    subscription.save()


def existing_customer_id(subscription):
    """The account's Stripe customer id, or '' when it has none in the current
    Stripe account."""
    if subscription.stripe_customer_id == '':
        return ''
    try:
        customer = stripe_client().v1.customers.retrieve(subscription.stripe_customer_id)
    except stripe.InvalidRequestError as error:
        if not is_missing(error):
            raise
        forget_stripe_ids(subscription)
        return ''
    if 'deleted' in customer and customer['deleted']:
        forget_stripe_ids(subscription)
        return ''
    return subscription.stripe_customer_id


def refresh_subscription(stripe_subscription_id):
    """Fetches a subscription from Stripe and updates the account it belongs to.
    Answers the updated Subscription, or None when the Stripe customer is not
    one of ours. A subscription unknown to the current Stripe account leaves
    its account with no Stripe subscription."""
    try:
        stripe_subscription = stripe_client().v1.subscriptions.retrieve(stripe_subscription_id)
    except stripe.InvalidRequestError as error:
        if not is_missing(error):
            raise
        subscription = Subscription.objects.filter(stripe_subscription_id=stripe_subscription_id).first()
        if subscription is not None:
            forget_stripe_ids(subscription)
        return subscription
    subscription = Subscription.objects.filter(stripe_customer_id=stripe_subscription['customer']).first()
    if subscription is None:
        return None
    apply_stripe_subscription(subscription, stripe_subscription)
    return subscription
