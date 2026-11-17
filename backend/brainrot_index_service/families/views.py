"""Creating a family, inviting and removing members, and changing roles.
Each member's settings and plugins are changed through the classification
endpoints under /api/family/members/<user_id>/."""

import secrets
from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.auth_tokens import hash_token
from classification.models import MODE_CHILD
from classification.views import settings_for_user

from .models import ROLE_CHILD, ROLE_CHOICES, ROLE_SUPERADMIN, Family, FamilyInvite, FamilyMember
from .permissions import membership_of, role_of

INVITE_LIFETIME = timedelta(days=7)
# No 0/O or 1/I/L, so a code read aloud or copied by hand comes out right.
INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
INVITE_CODE_LENGTH = 10

NOT_SUPERADMIN_MESSAGE = 'Only a superadmin of your family can do that.'
LAST_SUPERADMIN_MESSAGE = 'A family needs at least one superadmin. Make someone else a superadmin first.'
INVALID_INVITE_MESSAGE = 'This invite is not valid any more. Ask for a new one.'


class FamilyNameSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=1, max_length=60)


class RoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=ROLE_CHOICES)


class InviteCodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=40)


def generate_invite_code():
    return ''.join(secrets.choice(INVITE_CODE_ALPHABET) for _ in range(INVITE_CODE_LENGTH))


def normalized_invite_code(code):
    """The code as generated, however it was typed: any case, with dashes or spaces."""
    return code.upper().replace('-', '').replace(' ', '')


def open_invite_for(code):
    """The invite this code belongs to, if it is still unused, unrevoked and unexpired."""
    return (
        FamilyInvite.objects
        .select_related('family', 'created_by')
        .filter(
            code_hash=hash_token(normalized_invite_code(code)),
            accepted_at__isnull=True,
            revoked_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
        .first()
    )


def apply_child_settings(user):
    """A child's feed is in child mode, with filtered posts never revealed."""
    user_settings = settings_for_user(user)
    user_settings.mode = MODE_CHILD
    user_settings.allow_reveal = False
    user_settings.save(update_fields=['mode', 'allow_reveal'])


def superadmin_membership(user):
    membership = membership_of(user)
    if membership is None or membership.role != ROLE_SUPERADMIN:
        raise PermissionDenied(NOT_SUPERADMIN_MESSAGE)
    return membership


def family_data(membership):
    members = membership.family.members.select_related('user').order_by('joined_at', 'id')
    data = {
        'name': membership.family.name,
        'members': [
            {
                'user_id': member.user_id,
                'email': member.user.email,
                'role': member.role,
                'is_you': member.user_id == membership.user_id,
            }
            for member in members
        ],
    }
    if membership.role == ROLE_SUPERADMIN:
        open_invites = membership.family.invites.filter(
            accepted_at__isnull=True, revoked_at__isnull=True, expires_at__gt=timezone.now(),
        ).order_by('created_at')
        data['invites'] = [
            {'id': invite.id, 'role': invite.role, 'expires_at': invite.expires_at.isoformat()}
            for invite in open_invites
        ]
    return data


def family_response(user, response_status=status.HTTP_200_OK):
    membership = membership_of(user)
    if membership is None:
        family = None
    else:
        family = family_data(membership)
    return Response({'role': role_of(user), 'family': family}, status=response_status)


def superadmin_count_after(family, changed_member, new_role):
    """How many superadmins the family would have if changed_member had new_role
    (None for leaving). Locks the members, so two changes cannot both pass."""
    count = 0
    for member in FamilyMember.objects.select_for_update().filter(family=family):
        if member.id == changed_member.id:
            role = new_role
        else:
            role = member.role
        if role == ROLE_SUPERADMIN:
            count += 1
    return count


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def family_detail(request):
    """GET is the user's role and family (null when they have none); POST {name} creates one."""
    if request.method == 'GET':
        return family_response(request.user)

    serializer = FamilyNameSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    if membership_of(request.user) is not None:
        return Response({'error': 'You are already in a family.'}, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        family = Family.objects.create(name=serializer.validated_data['name'], created_by=request.user)
        FamilyMember.objects.create(user=request.user, family=family, role=ROLE_SUPERADMIN)
    return family_response(request.user, status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def create_invite(request):
    """POST {role} makes a single-use invite. The code is returned only here."""
    membership = superadmin_membership(request.user)
    serializer = RoleSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    code = generate_invite_code()
    invite = FamilyInvite.objects.create(
        family=membership.family,
        role=serializer.validated_data['role'],
        code_hash=hash_token(code),
        created_by=request.user,
        expires_at=timezone.now() + INVITE_LIFETIME,
    )
    return Response(
        {'id': invite.id, 'code': code, 'role': invite.role, 'expires_at': invite.expires_at.isoformat()},
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def revoke_invite(request, invite_id):
    membership = superadmin_membership(request.user)
    invite = get_object_or_404(FamilyInvite, id=invite_id, family=membership.family, accepted_at__isnull=True)
    invite.revoked_at = timezone.now()
    invite.save(update_fields=['revoked_at'])
    return family_response(request.user)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def preview_invite(request):
    """POST {code}: which family the invite is for and with what role, before accepting."""
    serializer = InviteCodeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    invite = open_invite_for(serializer.validated_data['code'])
    if invite is None:
        return Response({'error': INVALID_INVITE_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
    if invite.created_by is None:
        invited_by = ''
    else:
        invited_by = invite.created_by.email
    return Response({
        'family_name': invite.family.name,
        'role': invite.role,
        'invited_by': invited_by,
        'already_in_a_family': membership_of(request.user) is not None,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def join_family(request):
    """POST {code} accepts an invite."""
    serializer = InviteCodeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    if membership_of(request.user) is not None:
        return Response(
            {'error': 'You are already in a family. Leave it before joining another.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    with transaction.atomic():
        invite = open_invite_for(serializer.validated_data['code'])
        if invite is not None:
            # Lock and re-check, so one code cannot be accepted twice at once.
            invite = FamilyInvite.objects.select_for_update().get(id=invite.id)
        if invite is None or invite.accepted_at is not None:
            return Response({'error': INVALID_INVITE_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        FamilyMember.objects.create(user=request.user, family=invite.family, role=invite.role)
        invite.accepted_by = request.user
        invite.accepted_at = timezone.now()
        invite.save(update_fields=['accepted_by', 'accepted_at'])
        if invite.role == ROLE_CHILD:
            apply_child_settings(request.user)
    return family_response(request.user)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def leave_family(request):
    membership = membership_of(request.user)
    if membership is None:
        return Response({'error': 'You are not in a family.'}, status=status.HTTP_400_BAD_REQUEST)
    if membership.role == ROLE_CHILD:
        raise PermissionDenied('Ask a superadmin of your family to remove you.')

    with transaction.atomic():
        others_remain = FamilyMember.objects.filter(family=membership.family).exclude(id=membership.id).exists()
        if others_remain and superadmin_count_after(membership.family, membership, None) == 0:
            return Response({'error': LAST_SUPERADMIN_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        membership.delete()
    return family_response(request.user)


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
def family_member_detail(request, user_id):
    """PATCH {role} changes a member's role; DELETE removes them from the family."""
    membership = superadmin_membership(request.user)
    member = get_object_or_404(FamilyMember, family=membership.family, user_id=user_id)

    if request.method == 'DELETE':
        if member.id == membership.id:
            return Response(
                {'error': 'To remove yourself, leave the family instead.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        member.delete()
        return family_response(request.user)

    serializer = RoleSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    new_role = serializer.validated_data['role']
    with transaction.atomic():
        if superadmin_count_after(membership.family, member, new_role) == 0:
            return Response({'error': LAST_SUPERADMIN_MESSAGE}, status=status.HTTP_400_BAD_REQUEST)
        member.role = new_role
        member.save(update_fields=['role'])
        if new_role == ROLE_CHILD:
            apply_child_settings(member.user)
    return family_response(request.user)
