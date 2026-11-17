from rest_framework.permissions import BasePermission

from .models import UserProfile


class HasVerifiedEmail(BasePermission):
    """The account's email address is verified. A Google sign-in counts as verified.

    The 403 body carries a code the extension and the dashboard recognise.
    """

    message = {'detail': 'Verify your email first.', 'code': 'email_not_verified'}

    def has_permission(self, request, view):
        return UserProfile.objects.filter(user=request.user, email_verified=True).exists()
