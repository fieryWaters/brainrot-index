from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.authentication import BaseAuthentication, SessionAuthentication

from .models import UserProfile


class CSRFEnforcedSessionAuthentication(SessionAuthentication):
    """SessionAuthentication that enforces CSRF even on anonymous requests.

    DRF's default only checks CSRF once a session user is identified, which
    leaves anonymous POSTs (login, signup, password-reset) vulnerable to login
    CSRF / session fixation. Applied to the public auth endpoints via
    @authentication_classes so they reject cross-site forgeries regardless of
    the caller's auth state.
    """

    def authenticate(self, request):
        self.enforce_csrf(request)
        return super().authenticate(request)


class LocalBypassAuthentication(BaseAuthentication):
    """Dev-only: auto-authenticate as the local_dev user when LOCAL_AUTH_BYPASS is on."""

    def authenticate(self, request):
        if not getattr(settings, 'LOCAL_AUTH_BYPASS', False):
            return None

        user_model = get_user_model()
        local_username = getattr(settings, 'LOCAL_AUTH_USERNAME', 'local_dev')
        local_email = getattr(settings, 'LOCAL_AUTH_EMAIL', 'local@brainrotindex.local')

        local_user, _ = user_model.objects.get_or_create(
            username=local_username,
            defaults={'email': local_email},
        )
        if local_email and local_user.email != local_email:
            local_user.email = local_email
            local_user.save(update_fields=['email'])
        UserProfile.objects.get_or_create(user=local_user, defaults={'email_verified': True})

        return (local_user, None)
