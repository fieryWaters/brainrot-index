"""Whether an account may use filtering. account_has_access is the one place
that decides it. A family member is covered by any admin of their family
whose own subscription grants access, so the person who pays covers everyone."""

import logging

import stripe
from django.utils import timezone

from families.models import ROLE_ADMIN, FamilyMember

from .models import STATUS_ACTIVE, STATUS_PAST_DUE, STATUS_TRIALING, Subscription
from .stripe_sync import refresh_subscription

logger = logging.getLogger(__name__)

# past_due keeps access while Stripe retries the card; Stripe then moves the
# subscription to canceled or unpaid, which grant none.
PAYING_STATUSES = {STATUS_TRIALING, STATUS_ACTIVE, STATUS_PAST_DUE}


def subscription_for_user(user):
    return Subscription.objects.get(user=user)


def subscription_grants_access(subscription):
    now = timezone.now()
    if subscription.comp:
        return True
    if subscription.stripe_subscription_id == '':
        return subscription.status == STATUS_TRIALING and subscription.trial_end > now
    if subscription.status not in PAYING_STATUSES:
        return False
    return subscription.current_period_end > now


def account_has_access(user):
    if own_subscription_has_access(user):
        return True
    membership = FamilyMember.objects.filter(user=user).first()
    if membership is None:
        return False
    paying_admins = (
        FamilyMember.objects
        .filter(family_id=membership.family_id, role=ROLE_ADMIN)
        .exclude(user=user)
        .select_related('user')
    )
    return any(own_subscription_has_access(admin.user) for admin in paying_admins)


def own_subscription_has_access(user):
    subscription = subscription_for_user(user)
    if subscription_grants_access(subscription):
        return True
    if subscription.stripe_subscription_id == '' or subscription.status not in PAYING_STATUSES:
        return False

    # A paid period has ended here but no webhook said what happened next (a
    # renewal or a cancellation), so ask Stripe once. A cancellation is saved
    # as canceled, so this does not repeat.
    try:
        subscription = refresh_subscription(subscription.stripe_subscription_id)
    except stripe.StripeError:
        logger.warning('Could not refresh subscription of user %s from Stripe; allowing access', user.id)
        return True
    return subscription_grants_access(subscription)
