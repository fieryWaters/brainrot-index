"""The extension API (bearer token) and the website's settings endpoints (session)."""

import time

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.auth_tokens import generate_raw_token, hash_token

from .authentication import ExtensionTokenAuthentication
from .images import image_url_is_allowed
from .models import (
    ACTION_ALLOW,
    ACTION_BLUR,
    ACTION_HIDE,
    CLASSIFICATION_DONE,
    CLASSIFICATION_PENDING,
    MODE_CHILD,
    PLATFORM_REDDIT,
    PLATFORM_X,
    POST_KIND_REPLY,
    Classification,
    ExtensionToken,
    Plugin,
    Post,
    PostImage,
    UserPlugin,
    UserSettings,
)
from .serializers import ClassifyRequestSerializer, UserPluginSerializer, UserSettingsSerializer

# How long /classify/ waits for pending posts before answering, so most posts
# come back done on the first call.
PENDING_WAIT_SECONDS = 1.5
PENDING_RECHECK_SECONDS = 0.1

ACTION_SEVERITY = {
    ACTION_ALLOW: 0,
    ACTION_BLUR: 1,
    ACTION_HIDE: 2,
}


def settings_for_user(user):
    """The user's settings. The first call also installs every baseline plugin."""
    user_settings, created = UserSettings.objects.get_or_create(user=user)
    if created:
        UserPlugin.objects.bulk_create(
            [
                UserPlugin(user=user, plugin=plugin, threshold=plugin.default_threshold)
                for plugin in Plugin.objects.filter(is_baseline=True)
            ],
            ignore_conflicts=True,
        )
    return user_settings


def store_post(seen_post):
    """The stored Post for a seen post, created with its images the first time."""
    if seen_post['kind'] == POST_KIND_REPLY:
        parent_post_id = seen_post['parent_post_id']
    else:
        parent_post_id = ''

    # A blank URL or one off the platforms' media hosts is dropped, and the post
    # is classified on its text and remaining images.
    image_urls = [url for url in dict.fromkeys(seen_post['image_urls']) if image_url_is_allowed(url)]

    post, created = Post.objects.get_or_create(
        platform=seen_post['platform'],
        post_id=seen_post['post_id'],
        defaults={
            'kind': seen_post['kind'],
            'parent_post_id': parent_post_id,
            'url': seen_post['url'],
            'author': seen_post['author'],
            'community': seen_post['community'],
            'text': seen_post['text'],
            'image_urls': image_urls,
        },
    )
    if created:
        PostImage.objects.bulk_create([PostImage(post=post, source_url=url) for url in image_urls])
    return post


def build_results(posts, plugins_to_apply):
    """One result per post. plugins_to_apply is a list of (UserPlugin, PluginVersion)."""
    versions = [version for _, version in plugins_to_apply]
    classifications = {
        (classification.post_id, classification.plugin_version_id): classification
        for classification in Classification.objects.filter(post__in=posts, plugin_version__in=versions)
    }

    results = []
    for post in posts:
        result = {'platform': post.platform, 'post_id': post.post_id}
        post_classifications = [classifications[(post.id, version.id)] for version in versions]

        if any(classification.status == CLASSIFICATION_PENDING for classification in post_classifications):
            result['status'] = 'pending'
            results.append(result)
            continue

        # A failed classification counts as finished and never flags the post.
        action = ACTION_ALLOW
        reasons = []
        for (user_plugin, _), classification in zip(plugins_to_apply, post_classifications):
            if classification.status != CLASSIFICATION_DONE:
                continue
            if classification.score < user_plugin.threshold:
                continue
            reasons.append({
                'plugin': user_plugin.plugin.name,
                'label': classification.label,
                'score': classification.score,
            })
            if ACTION_SEVERITY[user_plugin.flagged_action] > ACTION_SEVERITY[action]:
                action = user_plugin.flagged_action

        # The extension shows the first reason, so the strongest comes first.
        reasons.sort(key=lambda reason: reason['score'], reverse=True)
        result['status'] = 'done'
        result['action'] = action
        result['reasons'] = reasons
        results.append(result)
    return results


def any_pending(results):
    return any(result['status'] == 'pending' for result in results)


# -- Extension endpoints (bearer token) --


@api_view(['GET'])
@authentication_classes([ExtensionTokenAuthentication])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def extension_config(request):
    user_settings = settings_for_user(request.user)
    child_mode = user_settings.mode == MODE_CHILD
    if child_mode:
        pending_action = ACTION_BLUR
    else:
        pending_action = ACTION_ALLOW
    return Response({
        'enabled': user_settings.enabled,
        'mode': user_settings.mode,
        'pending_action': pending_action,
        'allow_reveal': user_settings.allow_reveal and not child_mode,
        'platforms': [PLATFORM_REDDIT, PLATFORM_X],
    })


@api_view(['POST'])
@authentication_classes([ExtensionTokenAuthentication])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def classify(request):
    serializer = ClassifyRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    settings_for_user(request.user)
    enabled_plugins = UserPlugin.objects.filter(user=request.user, enabled=True).select_related('plugin')
    plugins_to_apply = [(user_plugin, user_plugin.plugin.latest_version()) for user_plugin in enabled_plugins]

    posts = [store_post(seen_post) for seen_post in serializer.validated_data['posts']]

    # Queue every missing (post, plugin version) pair; existing rows are the cache.
    Classification.objects.bulk_create(
        [Classification(post=post, plugin_version=version) for post in posts for _, version in plugins_to_apply],
        ignore_conflicts=True,
    )

    deadline = time.monotonic() + PENDING_WAIT_SECONDS
    results = build_results(posts, plugins_to_apply)
    while any_pending(results) and time.monotonic() < deadline:
        time.sleep(PENDING_RECHECK_SECONDS)
        results = build_results(posts, plugins_to_apply)

    return Response({'results': results})


# -- Website endpoints (session) --


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def create_extension_token(request):
    raw_token = generate_raw_token()
    ExtensionToken.objects.create(user=request.user, token_hash=hash_token(raw_token))
    return Response({'token': raw_token}, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def user_settings_detail(request):
    user_settings = settings_for_user(request.user)
    if request.method == 'GET':
        return Response(UserSettingsSerializer(user_settings).data)

    serializer = UserSettingsSerializer(user_settings, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def installed_plugin_list(request):
    settings_for_user(request.user)
    installed_plugins = UserPlugin.objects.filter(user=request.user).select_related('plugin').order_by('plugin__id')
    return Response({'plugins': UserPluginSerializer(installed_plugins, many=True).data})


@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def installed_plugin_detail(request, slug):
    settings_for_user(request.user)
    installed_plugin = get_object_or_404(
        UserPlugin.objects.select_related('plugin'),
        user=request.user,
        plugin__slug=slug,
    )
    serializer = UserPluginSerializer(installed_plugin, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)
