import hashlib
import logging
import uuid

from django.conf import settings
from django.contrib.auth import (
    authenticate,
    get_user_model,
    logout as django_logout,
    update_session_auth_hash,
)
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.password_validation import validate_password
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET
from django.http import JsonResponse
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .authentication import CSRFEnforcedSessionAuthentication
from .auth_serializers import (
    EmailOnlySerializer,
    EmailPasswordSerializer,
    ResetConfirmSerializer,
    SignupSerializer,
    TokenOnlySerializer,
)
from .auth_tokens import (
    EMAIL_VERIFICATION_TTL_MINUTES,
    PASSWORD_RESET_TTL_MINUTES,
    compute_expiry,
    generate_raw_token,
    hash_token,
    token_is_valid,
)
from .client_address import client_ip
from .emails import send_email_verification, send_password_reset
from .invites import invite_code_is_usable, invite_refusal, redeem_invite_code
from .sign_in import SIGN_IN_PASSWORD, sign_in
from .throttling import AnonRateThrottle, ScopedRateThrottle
from .views._common import build_session_payload
from .models import (
    AUTH_PROVIDER_HYBRID,
    AUTH_PROVIDER_PASSWORD,
    EmailVerificationToken,
    PasswordResetToken,
    UserProfile,
)

logger = logging.getLogger(__name__)
User = get_user_model()

# Real argon2 hash so check_password() in the user-not-found path runs the
# full KDF, equalizing login response time and preventing email enumeration.
_DUMMY_PASSWORD_HASH = make_password('timing-equalizer')


# Signup shares the login throttle so attackers can't bypass login rate limits
# via /signup (which falls through to login on password match).

class LoginIPThrottle(AnonRateThrottle):
    scope = 'auth_login'


class LoginAccountThrottle(ScopedRateThrottle):
    scope_attr = 'throttle_scope'
    scope = 'auth_login_account'

    def get_cache_key(self, request, view):
        email = (request.data.get('email') or '').strip().lower()
        if not email:
            return None
        email_hash = hashlib.sha256(email.encode('utf-8')).hexdigest()[:32]
        return self.cache_format % {'scope': self.scope, 'ident': email_hash}


class ResetRequestThrottle(AnonRateThrottle):
    scope = 'auth_reset_request'


class ResetConfirmThrottle(AnonRateThrottle):
    scope = 'auth_reset_confirm'


class VerifyThrottle(AnonRateThrottle):
    scope = 'auth_verify'


# -- Helpers --

def _mask_email(email):
    if not email or '@' not in email:
        return '<none>'
    local, domain = email.split('@', 1)
    if len(local) <= 2:
        return f"{local[0]}*@{domain}"
    return f"{local[0]}***{local[-1]}@{domain}"


def _get_or_create_profile(user):
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return profile


def _generate_username_for_email(email):
    candidate = email.lower()
    if len(candidate) <= 150:
        return candidate
    return uuid.uuid4().hex


def _delete_sessions_for_user(user_id, exclude_key=None):
    active_sessions = Session.objects.filter(expire_date__gt=timezone.now())
    target_id = str(user_id)
    for session in active_sessions.iterator():
        if session.session_key == exclude_key:
            continue
        if str(session.get_decoded().get('_auth_user_id', '')) == target_id:
            session.delete()


def _consume_pending_verification_tokens(user):
    """Invalidate any outstanding verification tokens (and their pending
    password hashes) for this user. Called whenever an out-of-band auth path
    (Google link, password reset) takes control, so a pre-planted signup hash
    can't be activated later."""
    EmailVerificationToken.objects.filter(
        user=user, consumed_at__isnull=True,
    ).update(consumed_at=timezone.now(), pending_password_hash='')


def _send_verification(user, ip, pending_password_hash=''):
    raw = generate_raw_token()
    EmailVerificationToken.objects.create(
        user=user,
        token_hash=hash_token(raw),
        expires_at=compute_expiry(EMAIL_VERIFICATION_TTL_MINUTES),
        pending_password_hash=pending_password_hash,
    )
    send_email_verification(user, raw)


# -- Endpoints --


@require_GET
@ensure_csrf_cookie
def csrf_bootstrap(request):
    # The sign-up page shows its invite code field only when one is needed.
    return JsonResponse({"status": "ok", "signup_requires_invite": settings.SIGNUP_REQUIRES_INVITE})


_SIGNUP_GENERIC_RESPONSE = {
    "status": "ok",
    "message": "Check your email to finish setting up your account.",
}


@api_view(['POST'])
@authentication_classes([CSRFEnforcedSessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([LoginIPThrottle, LoginAccountThrottle])
def signup(request):
    # Every branch returns an identical 202 body. The session cookie set by
    # sign_in() is what signals success to the frontend - the frontend
    # calls /auth/me/ after signup to see whether it was auto-logged-in.
    serializer = SignupSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(_SIGNUP_GENERIC_RESPONSE, status=202)

    email = serializer.validated_data['email'].strip().lower()
    password = serializer.validated_data['password']
    invite_code = serializer.validated_data['invite_code']
    ip = client_ip(request)

    try:
        validate_password(password, user=User(email=email, username=email))
    except ValidationError as exc:
        return Response({"error": " ".join(exc.messages)}, status=400)

    # Checked before looking the email up, so the answer does not reveal
    # whether an account exists. Only a new account uses the code up.
    if settings.SIGNUP_REQUIRES_INVITE and not invite_code_is_usable(invite_code):
        return Response(invite_refusal(invite_code), status=400)

    existing_user = User.objects.filter(email__iexact=email).first()

    if existing_user is not None and existing_user.has_usable_password():
        # Verified account (a usable password exists only after verification).
        # Try signup-as-login; on mismatch, return the same 202.
        authed = authenticate(request, username=existing_user.username, password=password)
        if authed is not None:
            sign_in(request, authed, SIGN_IN_PASSWORD)
            logger.info("signup->login: user=%s ip=%s", authed.id, ip)
        else:
            logger.info("signup collision (verified, bad pw): email=%s ip=%s",
                        _mask_email(email), ip)
        return Response(_SIGNUP_GENERIC_RESPONSE, status=202)

    if existing_user is not None:
        # Unverified account - either a stalled legitimate signup or an
        # attacker-planted row. Replace the pending password hash with the
        # new one and send a fresh verification email. Whoever clicks the
        # latest link wins - which goes to the real inbox owner.
        _consume_pending_verification_tokens(existing_user)
        _send_verification(existing_user, ip, pending_password_hash=make_password(password))
        sign_in(request, existing_user, SIGN_IN_PASSWORD)
        logger.info("signup (replaced pending): user=%s ip=%s", existing_user.id, ip)
        return Response(_SIGNUP_GENERIC_RESPONSE, status=202)

    # New account: create with unusable password, stash the real hash on the
    # verification token. The password only activates when the verify link is
    # clicked, proving inbox control.
    if settings.SIGNUP_REQUIRES_INVITE and not redeem_invite_code(invite_code):
        return Response(invite_refusal(invite_code), status=400)

    new_user = User.objects.create(
        username=_generate_username_for_email(email),
        email=email,
    )
    new_user.set_unusable_password()
    new_user.save()

    profile = _get_or_create_profile(new_user)
    profile.auth_provider = AUTH_PROVIDER_PASSWORD
    profile.email_verified = False
    profile.save()

    _send_verification(new_user, ip, pending_password_hash=make_password(password))
    sign_in(request, new_user, SIGN_IN_PASSWORD)
    logger.info("signup: user=%s email=%s ip=%s", new_user.id, _mask_email(email), ip)
    return Response(_SIGNUP_GENERIC_RESPONSE, status=202)


signup.throttle_scope = 'auth_login_account'


@api_view(['POST'])
@authentication_classes([CSRFEnforcedSessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([LoginIPThrottle, LoginAccountThrottle])
def login_view(request):
    serializer = EmailPasswordSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": "Invalid email or password."}, status=401)

    email = serializer.validated_data['email'].strip().lower()
    password = serializer.validated_data['password']
    ip = client_ip(request)

    user = User.objects.filter(email__iexact=email).first()
    if user is None:
        check_password(password, _DUMMY_PASSWORD_HASH)
        return Response({"error": "Invalid email or password."}, status=401)

    authed = authenticate(request, username=user.username, password=password)
    if authed is None:
        logger.info("login failed: email=%s ip=%s", _mask_email(email), ip)
        return Response({"error": "Invalid email or password."}, status=401)

    sign_in(request, authed, SIGN_IN_PASSWORD)
    logger.info("login: user=%s ip=%s", authed.id, ip)
    return Response(build_session_payload(authed), status=200)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    user_id = request.user.id
    django_logout(request)
    logger.info("logout: user=%s", user_id)
    return Response({"status": "ok"}, status=200)


@api_view(['POST'])
@authentication_classes([CSRFEnforcedSessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([VerifyThrottle])
def verify_email(request):
    serializer = TokenOnlySerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": "Token required."}, status=400)

    token_row = EmailVerificationToken.objects.filter(
        token_hash=hash_token(serializer.validated_data['token']),
    ).first()
    if token_row is None or not token_is_valid(token_row):
        return Response({"error": "This verification link has expired or been used."}, status=400)

    user = token_row.user
    # Activate the password that was parked on the token at signup time.
    # Until this moment the user row had an unusable password, so clicking
    # the verify link is what proves inbox control and grants credentials.
    if token_row.pending_password_hash:
        user.password = token_row.pending_password_hash
        user.save(update_fields=['password'])
        # A new password hash ends every session of the account. The browser
        # that signed up and now opened the link stays signed in.
        if request.user.is_authenticated and request.user.id == user.id:
            update_session_auth_hash(request, user)

    token_row.consumed_at = timezone.now()
    token_row.pending_password_hash = ''
    token_row.save(update_fields=['consumed_at', 'pending_password_hash'])

    profile = _get_or_create_profile(user)
    profile.email_verified = True
    profile.save(update_fields=['email_verified', 'updated_at'])

    logger.info("verify_email: user=%s", user.id)
    return Response({"status": "ok"}, status=200)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def resend_verification(request):
    profile = _get_or_create_profile(request.user)
    if profile.email_verified:
        return Response({"status": "ok"}, status=200)
    _send_verification(request.user, client_ip(request))
    return Response({"status": "ok"}, status=200)


@api_view(['POST'])
@authentication_classes([CSRFEnforcedSessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([ResetRequestThrottle])
def password_reset_request(request):
    # Always returns 202 to avoid leaking which emails are registered.
    serializer = EmailOnlySerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"status": "ok"}, status=202)

    email = serializer.validated_data['email'].strip().lower()
    ip = client_ip(request)
    user = User.objects.filter(email__iexact=email).first()

    if user is not None:
        raw = generate_raw_token()
        PasswordResetToken.objects.create(
            user=user,
            token_hash=hash_token(raw),
            expires_at=compute_expiry(PASSWORD_RESET_TTL_MINUTES),
        )
        send_password_reset(user, raw)
        logger.info("password_reset_request: user=%s ip=%s", user.id, ip)
    else:
        logger.info("password_reset_request miss: email=%s ip=%s", _mask_email(email), ip)

    return Response({"status": "ok"}, status=202)


@api_view(['POST'])
@authentication_classes([CSRFEnforcedSessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([ResetConfirmThrottle])
def password_reset_confirm(request):
    serializer = ResetConfirmSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"error": "Invalid request."}, status=400)

    token_row = PasswordResetToken.objects.filter(
        token_hash=hash_token(serializer.validated_data['token']),
    ).first()
    if token_row is None or not token_is_valid(token_row):
        return Response({"error": "This reset link has expired or been used."}, status=400)

    user = token_row.user
    new_password = serializer.validated_data['new_password']
    try:
        validate_password(new_password, user=user)
    except ValidationError as exc:
        return Response({"error": " ".join(exc.messages)}, status=400)

    user.set_password(new_password)
    user.save()

    # Reset proves inbox control, so any parked signup password hash is
    # now obsolete - drop it along with any outstanding verification tokens.
    _consume_pending_verification_tokens(user)

    PasswordResetToken.objects.filter(user=user, consumed_at__isnull=True).update(
        consumed_at=timezone.now(),
    )

    profile = _get_or_create_profile(user)
    profile.email_verified = True
    if profile.auth_provider != AUTH_PROVIDER_PASSWORD:
        profile.auth_provider = AUTH_PROVIDER_HYBRID
    profile.save()

    _delete_sessions_for_user(user.id, exclude_key=request.session.session_key)

    sign_in(request, user, SIGN_IN_PASSWORD)
    logger.info("password_reset_confirm: user=%s", user.id)
    return Response(build_session_payload(user), status=200)
