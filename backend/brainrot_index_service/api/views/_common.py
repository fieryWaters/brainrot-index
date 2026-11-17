"""Shared helpers for the API views: throttles and the session payload."""

from ..models import UserProfile
from ..throttling import AnonRateThrottle


class GoogleAuthAnonRateThrottle(AnonRateThrottle):
    pass


def build_session_payload(user):
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return {
        "email": user.email,
        "email_verified": profile.email_verified,
        "auth_provider": profile.auth_provider,
    }
