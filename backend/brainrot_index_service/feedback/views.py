from django.conf import settings
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from classification.authentication import ExtensionTokenAuthentication

from .serializers import FeedbackSerializer


# The extension sends a bearer token (no CSRF); the website sends its session
# cookie, and SessionAuthentication then enforces CSRF.
@api_view(['POST'])
@authentication_classes([ExtensionTokenAuthentication, SessionAuthentication])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def create_feedback(request):
    serializer = FeedbackSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    feedback = serializer.save(user=request.user, site_commit=settings.GIT_COMMIT)
    return Response({'id': feedback.id}, status=status.HTTP_201_CREATED)
