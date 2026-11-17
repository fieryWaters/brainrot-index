from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.permissions import BasePermission

from .access import account_has_access


class SubscriptionRequired(APIException):
    status_code = status.HTTP_402_PAYMENT_REQUIRED
    default_detail = {'detail': 'Your free trial has ended. Subscribe to continue.', 'code': 'subscription_required'}


class HasAccess(BasePermission):
    """The account is in its free trial, subscribed, or comp. Otherwise 402,
    which the extension shows as "trial ended, subscribe to continue"."""

    def has_permission(self, request, view):
        if not account_has_access(request.user):
            raise SubscriptionRequired()
        return True
