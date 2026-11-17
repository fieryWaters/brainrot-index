"""Billing: the account's subscription state, Stripe Checkout and Customer
Portal links, the return-from-Checkout reconcile, and the Stripe webhook."""

import logging
import math
from datetime import timedelta

import stripe
from django.conf import settings
from django.db import IntegrityError, transaction
from django.http import HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .access import account_has_access, subscription_for_user
from .models import STATUS_ACTIVE, STATUS_PAST_DUE, STATUS_TRIALING, StripeEvent
from .stripe_sync import monthly_price, portal_configuration_id, refresh_subscription, stripe_client

logger = logging.getLogger(__name__)

# Stripe requires a Checkout trial to end at least 48 hours from now.
SHORTEST_STRIPE_TRIAL = timedelta(hours=48)

SUBSCRIPTION_EVENTS = {
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
}
INVOICE_EVENTS = {
    'invoice.paid',
    'invoice.payment_failed',
}


def trial_days_left(subscription):
    if subscription.stripe_subscription_id != '' or subscription.trial_end is None:
        return None
    seconds_left = (subscription.trial_end - timezone.now()).total_seconds()
    if seconds_left <= 0:
        return 0
    return math.ceil(seconds_left / 86400)


def billing_payload(user):
    has_access = account_has_access(user)
    subscription = subscription_for_user(user)
    return {
        'status': subscription.status,
        'has_access': has_access,
        'comp': subscription.comp,
        'trial_end': subscription.trial_end,
        'trial_days_left': trial_days_left(subscription),
        'current_period_end': subscription.current_period_end,
        'cancel_at_period_end': subscription.cancel_at_period_end,
        'can_manage': subscription.stripe_customer_id != '',
    }


def payments_not_set_up():
    return Response({'error': 'Payments are not set up yet.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def billing_status(request):
    return Response(billing_payload(request.user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_checkout_session(request):
    if not settings.STRIPE_SECRET_KEY:
        return payments_not_set_up()

    subscription = subscription_for_user(request.user)
    if subscription.stripe_subscription_id != '' and subscription.status in {STATUS_TRIALING, STATUS_ACTIVE, STATUS_PAST_DUE}:
        return Response({'error': 'You are already subscribed.'}, status=status.HTTP_409_CONFLICT)

    price = monthly_price()
    if price is None:
        return payments_not_set_up()

    client = stripe_client()
    if subscription.stripe_customer_id == '':
        customer = client.v1.customers.create({
            'email': request.user.email,
            'metadata': {'user_id': str(request.user.id)},
        })
        subscription.stripe_customer_id = customer['id']
        subscription.save(update_fields=['stripe_customer_id', 'updated_at'])

    subscription_data = {'metadata': {'user_id': str(request.user.id)}}
    # Subscribing during the free trial keeps the days that are left, so the
    # first charge comes when the trial would have ended.
    if subscription.trial_end is not None and subscription.trial_end - timezone.now() >= SHORTEST_STRIPE_TRIAL:
        subscription_data['trial_end'] = int(subscription.trial_end.timestamp())

    checkout_session = client.v1.checkout.sessions.create({
        'mode': 'subscription',
        'customer': subscription.stripe_customer_id,
        'client_reference_id': str(request.user.id),
        'line_items': [{'price': price['id'], 'quantity': 1}],
        'subscription_data': subscription_data,
        'success_url': f'{settings.FRONTEND_BASE_URL}/billing/success?session_id={{CHECKOUT_SESSION_ID}}',
        'cancel_url': f'{settings.FRONTEND_BASE_URL}/billing/canceled',
    })
    return Response({'url': checkout_session['url']})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reconcile_checkout_session(request):
    """Called by the page Checkout returns to: reads the finished session from
    Stripe and updates the subscription, so paying works without the webhook."""
    session_id = str(request.data.get('session_id', '')).strip()
    if not session_id or not settings.STRIPE_SECRET_KEY:
        return Response({'error': 'session_id required'}, status=status.HTTP_400_BAD_REQUEST)

    subscription = subscription_for_user(request.user)
    try:
        checkout_session = stripe_client().v1.checkout.sessions.retrieve(session_id)
    except stripe.InvalidRequestError:
        return Response({'error': 'Checkout session not found'}, status=status.HTTP_404_NOT_FOUND)
    if subscription.stripe_customer_id == '' or checkout_session['customer'] != subscription.stripe_customer_id:
        return Response({'error': 'Checkout session not found'}, status=status.HTTP_404_NOT_FOUND)

    if checkout_session['status'] == 'complete':
        refresh_subscription(checkout_session['subscription'])
    return Response(billing_payload(request.user))


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_portal_session(request):
    subscription = subscription_for_user(request.user)
    if not settings.STRIPE_SECRET_KEY or subscription.stripe_customer_id == '':
        return Response({'error': 'No subscription to manage.'}, status=status.HTTP_400_BAD_REQUEST)

    portal_session = stripe_client().v1.billing_portal.sessions.create({
        'customer': subscription.stripe_customer_id,
        'configuration': portal_configuration_id(),
        'return_url': f'{settings.FRONTEND_BASE_URL}/dashboard',
    })
    return Response({'url': portal_session['url']})


def subscription_id_for_event(event):
    """The Stripe subscription an event is about, or None."""
    event_object = event['data']['object']
    if event['type'] == 'checkout.session.completed':
        return event_object['subscription']
    if event['type'] in SUBSCRIPTION_EVENTS:
        return event_object['id']
    if event['type'] in INVOICE_EVENTS:
        parent = event_object['parent']
        if parent is None or parent['subscription_details'] is None:
            return None
        return parent['subscription_details']['subscription']
    return None


@csrf_exempt
@require_POST
def stripe_webhook(request):
    """Every handled event is answered by fetching the subscription it names
    from Stripe, so events arriving out of order still leave the latest state."""
    if not settings.STRIPE_WEBHOOK_SECRET:
        return HttpResponse(status=400)
    try:
        event = stripe.Webhook.construct_event(
            request.body,
            request.META.get('HTTP_STRIPE_SIGNATURE', ''),
            settings.STRIPE_WEBHOOK_SECRET,
        )
    except (ValueError, stripe.SignatureVerificationError):
        return HttpResponse(status=400)

    # Recording the event and acting on it commit together: if acting fails,
    # Stripe redelivers it and it is handled then.
    with transaction.atomic():
        try:
            with transaction.atomic():
                StripeEvent.objects.create(event_id=event['id'], event_type=event['type'])
        except IntegrityError:
            return HttpResponse(status=200)

        stripe_subscription_id = subscription_id_for_event(event)
        if stripe_subscription_id is not None:
            refresh_subscription(stripe_subscription_id)

    logger.info('Stripe webhook %s %s handled', event['type'], event['id'])
    return HttpResponse(status=200)
