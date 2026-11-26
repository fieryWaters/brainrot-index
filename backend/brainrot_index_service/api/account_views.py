"""The signed-in person's own account: change the password, sign out of every
browser and extension, download their data, and delete the account."""

import json
import logging

import stripe
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
from classification.models import ExtensionToken, Plugin, PostJudgment, PostSubmission, UserPlugin, UserSettings
from families.models import ROLE_ADMIN, FamilyMember
from families.views import LAST_ADMIN_MESSAGE
from feedback.models import Feedback
from store.models import PluginRating, PluginReport

from .auth_views import _delete_sessions_for_user, _get_or_create_profile
from .models import ExtensionDataConsent
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
    every extension, so each connects again only once its browser signs in."""
    user_id = request.user.id
    ExtensionToken.objects.filter(user=request.user).delete()
    _delete_sessions_for_user(user_id)
    django_logout(request)
    logger.info('sign_out_everywhere: user=%s', user_id)
    return Response({'status': 'ok'})


def account_data(user):
    """Everything stored about the person, as plain JSON values. The posts the
    extension sent are listed by id and address with when they were sent; the
    posts' contents and classifications are shared by every account that sent
    them, so they are not repeated here."""
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
            # Filled in from Google for accounts made with Google sign-in.
            'name': f'{user.first_name} {user.last_name}'.strip(),
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
        'extension_data_consents': [
            {
                'disclosure_version': consent.disclosure_version,
                'agreed_at': consent.agreed_at.isoformat(),
                'withdrawn_at': consent.withdrawn_at and consent.withdrawn_at.isoformat(),
            }
            for consent in ExtensionDataConsent.objects.filter(user=user).order_by('agreed_at')
        ],
        'sent_posts': [
            {
                'platform': submission.post.platform,
                'post_id': submission.post.post_id,
                'url': submission.post.url,
                'first_seen_at': submission.first_seen_at.isoformat(),
                'last_seen_at': submission.last_seen_at.isoformat(),
            }
            for submission in PostSubmission.objects.filter(user=user).select_related('post').order_by('first_seen_at', 'id')
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
        'family': family_data_for_export(user),
        'published_plugins': [
            {'slug': plugin.slug, 'name': plugin.name, 'author_name': plugin.author_name}
            for plugin in Plugin.objects.filter(author=user).order_by('id')
        ],
        'plugin_ratings': [
            {
                'plugin': rating.plugin.slug,
                'stars': rating.stars,
                'review': rating.review,
                'created_at': rating.created_at.isoformat(),
            }
            for rating in PluginRating.objects.filter(user=user).select_related('plugin').order_by('created_at')
        ],
        'plugin_reports': [
            {'plugin': report.plugin.slug, 'reason': report.reason, 'created_at': report.created_at.isoformat()}
            for report in PluginReport.objects.filter(user=user).select_related('plugin').order_by('created_at')
        ],
    }


def family_data_for_export(user):
    membership = FamilyMember.objects.filter(user=user).select_related('family').first()
    if membership is None:
        return None
    return {
        'name': membership.family.name,
        'role': membership.role,
        'joined_at': membership.joined_at.isoformat(),
    }


def is_last_admin_of_a_family_with_others(user):
    membership = FamilyMember.objects.filter(user=user).first()
    if membership is None or membership.role != ROLE_ADMIN:
        return False
    others = FamilyMember.objects.filter(family=membership.family).exclude(user=user)
    if not others.exists():
        return False
    return not others.filter(role=ROLE_ADMIN).exists()


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
    """Deletes the account and every row that belongs to it, except feedback
    and thumbs on posts, which stay without their sender. The confirmation
    is the account's email address, typed by the person."""
    user = request.user
    typed_email = str(request.data.get('email', '')).strip().lower()
    if typed_email != user.email.lower():
        return Response({'error': 'Type your email address exactly as shown to confirm.'}, status=400)

    # The same rule as leaving the family: the others must not be left without an admin.
    if is_last_admin_of_a_family_with_others(user):
        return Response({'error': LAST_ADMIN_MESSAGE}, status=400)

    # A paid subscription is canceled first, so a deleted account is never charged again.
    subscription = subscription_for_user(user)
    if subscription.stripe_subscription_id != '' and subscription.status in PAYING_STATUSES:
        try:
            stripe_client().v1.subscriptions.cancel(subscription.stripe_subscription_id)
        except stripe.StripeError:
            logger.warning('delete_account: could not cancel Stripe subscription of user %s', user.id)
            return Response(
                {'error': 'Could not cancel your subscription, so nothing was deleted. '
                          'Please try again, or tell us with the Feedback button.'},
                status=502,
            )

    # A plugin the person published stays for the people who installed it, without an author.
    Plugin.objects.filter(author=user).update(author=None, author_name='')
    # Feedback and thumbs on posts stay, without who sent them: the thumbs are
    # the test set for filters. The name and address typed for a reply go too.
    Feedback.objects.filter(user=user).update(user=None, name='', reply_email='')
    PostJudgment.objects.filter(user=user).update(user=None)

    user_id = user.id
    _delete_sessions_for_user(user_id, exclude_key=request.session.session_key)
    django_logout(request)
    user.delete()
    logger.info('delete_account: user=%s', user_id)
    return Response({'status': 'ok'})
