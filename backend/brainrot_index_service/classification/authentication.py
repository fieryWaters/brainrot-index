from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from api.auth_tokens import hash_token

from .models import ExtensionToken


class ExtensionTokenAuthentication(BaseAuthentication):
    """Authenticates the browser extension by `Authorization: Bearer <token>`.

    Requests carry no session cookie, so there is nothing for CSRF to protect.
    """

    def authenticate(self, request):
        authorization = request.META.get('HTTP_AUTHORIZATION', '')
        if not authorization.startswith('Bearer '):
            return None

        raw_token = authorization.removeprefix('Bearer ').strip()
        extension_token = ExtensionToken.objects.select_related('user').filter(
            token_hash=hash_token(raw_token),
            user__is_active=True,
        ).first()
        if extension_token is None:
            raise AuthenticationFailed('Invalid extension token')

        ExtensionToken.objects.filter(id=extension_token.id).update(last_used_at=timezone.now())
        return (extension_token.user, extension_token)

    def authenticate_header(self, request):
        # Makes DRF answer 401 (not 403) when the token is missing or invalid.
        return 'Bearer'
