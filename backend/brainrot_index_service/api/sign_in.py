"""Signing a user in, remembering in the session how they signed in.
The admin admits only sessions that signed in with Google."""

from django.contrib.auth import login as django_login

SIGN_IN_METHOD_SESSION_KEY = 'sign_in_method'
SIGN_IN_PASSWORD = 'password'
SIGN_IN_GOOGLE = 'google'


def sign_in(request, user, method):
    django_login(request, user)
    request.session[SIGN_IN_METHOD_SESSION_KEY] = method
