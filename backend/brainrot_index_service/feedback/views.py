from django.conf import settings
from django.contrib import admin
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from api.emails import send_feedback_alert
from api.throttling import AnonRateThrottle
from classification.authentication import ExtensionTokenAuthentication

from .inbox import STATUS_OPEN, STATUSES, UnknownItem, find_item, inbox_items, item_as_dict, resolve_item
from .models import SOURCE_CONTACT, Feedback
from .serializers import ContactSerializer, FeedbackSerializer, ResolveSerializer


# Signed-in senders are not limited; people who are not signed in share this per-address limit.
class AnonymousFeedbackThrottle(AnonRateThrottle):
    scope = 'feedback_anon'


# The extension sends a bearer token (no CSRF); the website sends its session
# cookie, and SessionAuthentication then enforces CSRF. Someone not signed in
# may send feedback from the website; it is stored without a user, with the
# reply address they typed, if any. Each report is emailed to the admin.
@api_view(['POST'])
@authentication_classes([ExtensionTokenAuthentication, SessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([AnonymousFeedbackThrottle])
def create_feedback(request):
    serializer = FeedbackSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    if request.user.is_authenticated:
        user = request.user
    else:
        user = None
    feedback = serializer.save(user=user, site_commit=settings.GIT_COMMIT)
    send_feedback_alert(feedback)
    return Response({'id': feedback.id}, status=status.HTTP_201_CREATED)


# The contact form, open to everyone. A message is stored as feedback from the
# contact form, so it lands in the inbox, and is emailed to the admin with
# Reply-To set to the sender's address.
@api_view(['POST'])
@authentication_classes([SessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([AnonymousFeedbackThrottle])
def create_contact_message(request):
    serializer = ContactSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    contact = serializer.validated_data
    if request.user.is_authenticated:
        user = request.user
    else:
        user = None
    feedback = Feedback.objects.create(
        user=user,
        source=SOURCE_CONTACT,
        name=contact['name'],
        reply_email=contact['email'],
        subject=contact['subject'],
        text=contact['message'],
        site_commit=settings.GIT_COMMIT,
    )
    send_feedback_alert(feedback)
    return Response({'id': feedback.id}, status=status.HTTP_201_CREATED)


class CanOpenInbox(BasePermission):
    """The same people the admin lets in: the ADMIN_EMAIL account, signed in with Google."""

    def has_permission(self, request, view):
        return admin.site.has_permission(request)


@api_view(['GET'])
@authentication_classes([SessionAuthentication])
@permission_classes([CanOpenInbox])
@throttle_classes([])
def list_inbox(request):
    item_status = request.query_params.get('status', STATUS_OPEN)
    if item_status not in STATUSES:
        return Response({'error': f"status must be one of {', '.join(STATUSES)}"}, status=status.HTTP_400_BAD_REQUEST)
    return Response({'items': inbox_items(item_status)})


@api_view(['GET'])
@authentication_classes([SessionAuthentication])
@permission_classes([CanOpenInbox])
@throttle_classes([])
def inbox_item(request, item_id):
    try:
        found = find_item(item_id)
    except UnknownItem:
        return Response({'error': f"No inbox item {item_id}"}, status=status.HTTP_404_NOT_FOUND)
    return Response(item_as_dict(found))


@api_view(['POST'])
@authentication_classes([SessionAuthentication])
@permission_classes([CanOpenInbox])
@throttle_classes([])
def resolve_inbox_item(request, item_id):
    serializer = ResolveSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        resolved = resolve_item(item_id, serializer.validated_data['commit'], serializer.validated_data['note'])
    except UnknownItem:
        return Response({'error': f"No inbox item {item_id}"}, status=status.HTTP_404_NOT_FOUND)
    return Response(item_as_dict(resolved))
