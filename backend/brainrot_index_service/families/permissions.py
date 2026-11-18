"""Who may see and change whose filters.

A user with no family is their own admin, so everything works for them
exactly as it did before families existed."""

from django.contrib.auth import get_user_model
from rest_framework.exceptions import NotFound, PermissionDenied

from .models import ROLE_ADMIN, ROLE_CHILD, FamilyMember

CHILD_CANNOT_CHANGE_MESSAGE = "An admin of your family manages your filters."


def membership_of(user):
    """The user's FamilyMember row, or None when they are in no family."""
    return FamilyMember.objects.filter(user=user).select_related('family').first()


def role_of(user):
    membership = membership_of(user)
    if membership is None:
        return ROLE_ADMIN
    return membership.role


def is_child(user):
    return role_of(user) == ROLE_CHILD


def manages(actor, target):
    """True when actor is an admin of the family target belongs to."""
    actor_membership = membership_of(actor)
    if actor_membership is None or actor_membership.role != ROLE_ADMIN:
        return False
    return FamilyMember.objects.filter(user=target, family=actor_membership.family).exists()


def can_change_filters_of(actor, target):
    if actor == target:
        return not is_child(actor)
    return manages(actor, target)


def filters_owner(request, user_id, change):
    """The user whose settings and plugins a request is about: the signed-in
    user when user_id is None, otherwise a member of their family. Raises when
    the request may not see them, or may not change them when change is True."""
    if user_id is None:
        target = request.user
    else:
        target = get_user_model().objects.filter(id=user_id).first()
        if target is None or (target != request.user and not manages(request.user, target)):
            raise NotFound('No such member in your family.')

    if change and not can_change_filters_of(request.user, target):
        raise PermissionDenied(CHILD_CANNOT_CHANGE_MESSAGE)
    return target


def require_not_child(user, message):
    if is_child(user):
        raise PermissionDenied(message)
