from django.conf import settings
from django.contrib import admin
from django.shortcuts import redirect

from api.sign_in import SIGN_IN_GOOGLE, SIGN_IN_METHOD_SESSION_KEY


class OwnerAdminSite(admin.AdminSite):
    """The admin, open only to the account whose email is ADMIN_EMAIL, and only
    in a session that signed in with Google. is_staff alone lets nobody in."""

    def has_permission(self, request):
        user = request.user
        if not user.is_active or not user.is_authenticated:
            return False
        if not settings.ADMIN_EMAIL or user.email.lower() != settings.ADMIN_EMAIL:
            return False
        return request.session.get(SIGN_IN_METHOD_SESSION_KEY) == SIGN_IN_GOOGLE

    # No password form here: signing in happens on the site's own login page.
    def login(self, request, extra_context=None):
        return redirect('/login')
