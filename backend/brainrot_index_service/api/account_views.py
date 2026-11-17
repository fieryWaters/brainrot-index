"""The signed-in person's own account: change the password, sign out of every
browser and extension, download their data, and delete the account."""

import json
import logging

import stripe
from django.conf import settings
from django.contrib.auth import logout as django_logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from billing.access import PAYING_STATUSES, subscription_for_user
from billing.stripe_sync import stripe_client
from classification.models import ExtensionToken, Plugin, UserPlugin, UserSettings
from feedback.models import Feedback

from .auth_views import _delete_sessions_for_user, _get_or_create_profile
from .throttling import UserRateThrottle

logger = logging.getLogger(__name__)


class AccountChangeThrottle(UserRateThrottle):
    scope = 'account_change'


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([AccountChangeThrottle])
def change_password(request):
    user = request.user
    if not user.has_usable_password():
        return Response({'error': 'This account has no password yet. Use the email link to set one.'}, status=400)

    current_password = str(request.data.get('current_password', ''))
    new_password = str(request.data.get('new_password', ''))
    if not user.check_password(current_password):
        return Response({'error': 'Your current password is not right.'}, status=400)
    try:
        validate_password(new_password, user=user)
    except ValidationError as exc:
        return Response({'error': ' '.join(exc.messages)}, status=400)

    user.set_password(new_password)
    user.save(update_fields=['password'])
    # This browser stays signed in; every other session ends.
    update_session_auth_hash(request, user)
    _delete_sessions_for_user(user.id, exclude_key=request.session.session_key)
    logger.info('change_password: user=%s', user.id)
    return Response({'status': 'ok'})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([AccountChangeThrottle])
def sign_out_everywhere(request):
    """Ends every session of the account, this one included, and disconnects
    every extension, so each must press Connect extension again."""
    user_id = request.user.id
    ExtensionToken.objects.filter(user=request.user).delete()
    _delete_sessions_for_user(user_id)
    django_logout(request)
    logger.info('sign_out_everywhere: user=%s', user_id)
    return Response({'status': 'ok'})


def account_data(user):
    """Everything stored about the person, as plain JSON values. Posts and
    their classifications are not included: they are shared by every account
    and record nothing about who saw them."""
    profile = _get_or_create_profile(user)
    subscription = subscription_for_user(user)
    user_settings = UserSettings.objects.filter(user=user).first()

    if user_settings is None:
        settings_data = None
    else:
        settings_data = {
            'enabled': user_settings.enabled,
            'mode': user_settings.mode,
            'allow_reveal': user_settings.allow_reveal,
        }

    return {
        'exported_at': timezone.now().isoformat(),
        'account': {
            'email': user.email,
            'created_at': user.date_joined.isoformat(),
            'email_verified': profile.email_verified,
            'sign_in_method': profile.auth_provider,
        },
        'subscription': {
            'status': subscription.status,
            'trial_end': subscription.trial_end and subscription.trial_end.isoformat(),
            'current_period_end': subscription.current_period_end and subscription.current_period_end.isoformat(),
            'cancel_at_period_end': subscription.cancel_at_period_end,
            'free_forever': subscription.comp,
        },
        'settings': settings_data,
        'plugins': [
            {
                'slug': installed.plugin.slug,
                'name': installed.plugin.name,
                'enabled': installed.enabled,
                'threshold': installed.threshold,
                'flagged_action': installed.flagged_action,
                'installed_at': installed.installed_at.isoformat(),
            }
            for installed in UserPlugin.objects.filter(user=user).select_related('plugin').order_by('plugin__id')
        ],
        'extension_connections': [
            {
                'created_at': token.created_at.isoformat(),
                'last_used_at': token.last_used_at and token.last_used_at.isoformat(),
            }
            for token in ExtensionToken.objects.filter(user=user).order_by('created_at')
        ],
        'feedback': [
            {
                'created_at': report.created_at.isoformat(),
                'source': report.source,
                'text': report.text,
                'page_url': report.page_url,
                'platform': report.platform,
                'post_id': report.post_id,
                'shown_action': report.shown_action,
                'expected_action': report.expected_action,
                'resolved': report.resolved,
                'resolved_note': report.resolved_note,
            }
            for report in Feedback.objects.filter(user=user).order_by('created_at')
        ],
    }


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([AccountChangeThrottle])
def export_account_data(request):
    response = HttpResponse(
        json.dumps(account_data(request.user), indent=2),
        content_type='application/json',
    )
    response['Content-Disposition'] = 'attachment; filename="brainrot-index-my-data.json"'
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([AccountChangeThrottle])
def delete_account(request):
    """Deletes the account and every row that belongs to it. The confirmation
    is the account's email address, typed by the person."""
    user = request.user
    typed_email = str(request.data.get('email', '')).strip().lower()
    if typed_email != user.email.lower():
        return Response({'error': 'Type your email address exactly as shown to confirm.'}, status=400)

    # A paid subscription is canceled first, so a deleted account is never charged again.
    subscription = subscription_for_user(user)
    if subscription.stripe_subscription_id != '' and subscription.status in PAYING_STATUSES:
        try:
            stripe_client().v1.subscriptions.cancel(subscription.stripe_subscription_id)
        except stripe.StripeError:
            logger.warning('delete_account: could not cancel Stripe subscription of user %s', user.id)
            return Response(
                {'error': f'Could not cancel your subscription, so nothing was deleted. '
                          f'Please try again, or write to {settings.SUPPORT_EMAIL}.'},
                status=502,
            )

    # A plugin the person published stays for the people who installed it, without an author.
    Plugin.objects.filter(author=user).update(author=None)

    user_id = user.id
    _delete_sessions_for_user(user_id, exclude_key=request.session.session_key)
    django_logout(request)
    user.delete()
    logger.info('delete_account: user=%s', user_id)
    return Response({'status': 'ok'})
