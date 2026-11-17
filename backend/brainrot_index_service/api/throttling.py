"""DRF's throttles, keyed on the client address nginx vouches for.

DRF's own get_ident trusts the whole X-Forwarded-For header, which a client
can write. Every throttle in the project derives from these classes.
"""

from rest_framework import throttling

from .client_address import client_ip


class ClientAddressIdent:
    def get_ident(self, request):
        return client_ip(request)


class AnonRateThrottle(ClientAddressIdent, throttling.AnonRateThrottle):
    pass


class UserRateThrottle(ClientAddressIdent, throttling.UserRateThrottle):
    pass


class ScopedRateThrottle(ClientAddressIdent, throttling.ScopedRateThrottle):
    pass


class ChangeRateThrottle(UserRateThrottle):
    """Limits only requests that change something, for views that also answer GET."""

    def allow_request(self, request, view):
        if request.method == 'GET':
            return True
        return super().allow_request(request, view)
