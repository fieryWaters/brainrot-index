from django.conf import settings
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from classification.authentication import ExtensionTokenAuthentication

from .serializers import FeedbackSerializer


# Signed-in senders are not limited; people who are not signed in share this per-address limit.
class AnonymousFeedbackThrottle(AnonRateThrottle):
    scope = 'feedback_anon'


# The extension sends a bearer token (no CSRF); the website sends its session
# cookie, and SessionAuthentication then enforces CSRF. Someone not signed in
# may send feedback from the website; it is stored without a user.
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
    return Response({'id': feedback.id}, status=status.HTTP_201_CREATED)
