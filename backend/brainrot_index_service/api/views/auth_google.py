"""Google account authentication + the /auth/me/ session read. Email/password
flows live in auth_views.py (its own concern); this is the Google OAuth path
that verifies the id_token and provisions/links the account."""

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.views.decorators.csrf import csrf_exempt
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from ._common import GoogleAuthAnonRateThrottle, build_session_payload
from ..invites import invite_refusal, redeem_invite_code
from ..models import AUTH_PROVIDER_GOOGLE, AUTH_PROVIDER_HYBRID, UserProfile
from ..sign_in import SIGN_IN_GOOGLE, sign_in

logger = logging.getLogger(__name__)
User = get_user_model()


@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([GoogleAuthAnonRateThrottle])
def authenticate_with_google(request):
    google_identity_token = str(request.data.get('id_token', '')).strip()
    if not google_identity_token:
        return Response({"error": "id_token required"}, status=status.HTTP_400_BAD_REQUEST)

    google_client_id = settings.GOOGLE_CLIENT_ID
    if not google_client_id:
        return Response(
            {"error": "Google authentication is not configured"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    try:
        google_token_payload = google_id_token.verify_oauth2_token(
            google_identity_token,
            google_requests.Request(),
            google_client_id,
        )
    except ValueError:
        return Response({"error": "Invalid Google identity token"}, status=status.HTTP_401_UNAUTHORIZED)

    if google_token_payload.get('iss') not in {'accounts.google.com', 'https://accounts.google.com'}:
        return Response({"error": "Invalid token issuer"}, status=status.HTTP_401_UNAUTHORIZED)
    if not google_token_payload.get('email_verified', False):
        return Response({"error": "Google email is not verified"}, status=status.HTTP_403_FORBIDDEN)

    google_subject = str(google_token_payload.get('sub', '')).strip()
    google_email = str(google_token_payload.get('email', '')).strip().lower()
    if not google_subject or not google_email:
        return Response({"error": "Google token missing user fields"}, status=status.HTTP_400_BAD_REQUEST)

    application_user = User.objects.filter(email__iexact=google_email).first()
    was_existing = application_user is not None

    if was_existing:
        # An existing row reached via Google could be an attacker-planted
        # signup stub. Invalidate any parked password hash and kill any
        # pre-existing sessions before we issue a fresh one to the verified
        # Google owner of this address.
        from ..auth_views import _consume_pending_verification_tokens, _delete_sessions_for_user
        _consume_pending_verification_tokens(application_user)
        _delete_sessions_for_user(application_user.id, exclude_key=request.session.session_key)

    if application_user is None:
        invite_code = request.data.get('invite_code', '')
        if settings.SIGNUP_REQUIRES_INVITE and not redeem_invite_code(invite_code):
            return Response(invite_refusal(invite_code), status=status.HTTP_403_FORBIDDEN)
        application_user = User.objects.create(
            username=f"google_{google_subject}",
            email=google_email,
            first_name=str(google_token_payload.get('given_name', ''))[:150],
            last_name=str(google_token_payload.get('family_name', ''))[:150],
        )
        application_user.set_unusable_password()
        application_user.save()

    user_dirty_fields = []
    if application_user.email != google_email:
        application_user.email = google_email
        user_dirty_fields.append('email')
    # The admin account gets the admin's permissions; OwnerAdminSite decides
    # who may open /admin/ at all.
    if settings.ADMIN_EMAIL and google_email == settings.ADMIN_EMAIL and not application_user.is_superuser:
        application_user.is_staff = True
        application_user.is_superuser = True
        user_dirty_fields += ['is_staff', 'is_superuser']
    if user_dirty_fields:
        application_user.save(update_fields=user_dirty_fields)

    profile, _ = UserProfile.objects.get_or_create(user=application_user)
    profile.email_verified = True
    profile.auth_provider = (
        AUTH_PROVIDER_HYBRID if application_user.has_usable_password() else AUTH_PROVIDER_GOOGLE
    )
    profile.save(update_fields=['email_verified', 'auth_provider', 'updated_at'])

    sign_in(request, application_user, SIGN_IN_GOOGLE)

    logger.info(
        "Google login: user=%s new=%s provider=%s",
        application_user.id, not was_existing, profile.auth_provider,
    )

    session_payload = build_session_payload(request)
    session_payload["is_new_user"] = not was_existing
    return Response(session_payload, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def current_session(request):
    return Response(build_session_payload(request), status=status.HTTP_200_OK)
