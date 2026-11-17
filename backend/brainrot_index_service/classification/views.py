"""The extension API (bearer token) and the website's settings endpoints (session)."""

import time
from collections import Counter

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.auth_tokens import generate_raw_token, hash_token
from api.models import DailyNewPostCount, UserProfile
from api.permissions import HasVerifiedEmail
from api.throttling import UserRateThrottle
from billing.permissions import HasAccess
from families.permissions import can_change_filters_of, filters_owner

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
    PLATFORM_YOUTUBE,
    POST_KIND_REPLY,
    Classification,
    ExtensionToken,
    Plugin,
    Post,
    PostImage,
    UserPlugin,
    UserSettings,
    VideoTranscript,
)
from .serializers import ClassifyRequestSerializer, UserPluginSerializer, UserSettingsSerializer

# How long /classify/ waits for pending posts before answering, so most posts
# come back done on the first call.
PENDING_WAIT_SECONDS = 1.5
PENDING_RECHECK_SECONDS = 0.1

# Every enabled plugin is one more model call for each new post a user sees,
# so the number an account can have turned on at once is capped.
MAX_ENABLED_PLUGINS = 8
ENABLED_PLUGIN_LIMIT_MESSAGE = (
    f"At most {MAX_ENABLED_PLUGINS} plugins can be on at once, because each one checks every post. "
    "Turn one off first."
)

ACTION_SEVERITY = {
    ACTION_ALLOW: 0,
    ACTION_BLUR: 1,
    ACTION_HIDE: 2,
}

# Marks the answer for a post that was not classified because the account
# used up its daily quota of new posts.
NOTICE_DAILY_LIMIT_REACHED = 'daily_limit_reached'


class ClassifyThrottle(UserRateThrottle):
    scope = 'classify'


class ExtensionConfigThrottle(UserRateThrottle):
    scope = 'extension_config'


class ExtensionTokenThrottle(UserRateThrottle):
    scope = 'extension_token'


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
    """The stored Post for a seen post, created with its images (and, for a
    video, its transcript to fetch) the first time."""
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
        if post.platform == PLATFORM_YOUTUBE:
            VideoTranscript.objects.create(post=post)
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


def seen_posts_needing_classification(seen_posts, versions):
    """The seen posts that lack a classification for at least one of the versions:
    the ones that cost new model calls."""
    classification_counts = Counter(
        Classification.objects.filter(
            post__post_id__in=[seen_post['post_id'] for seen_post in seen_posts],
            plugin_version__in=versions,
        ).values_list('post__platform', 'post__post_id')
    )
    return [
        seen_post for seen_post in seen_posts
        if classification_counts[(seen_post['platform'], seen_post['post_id'])] < len(versions)
    ]


def take_from_daily_quota(user, wanted_count):
    """Counts up to wanted_count new posts against the user's quota for today (UTC).
    Answers how many were granted."""
    if wanted_count == 0:
        return 0
    with transaction.atomic():
        daily_count, _ = DailyNewPostCount.objects.select_for_update().get_or_create(
            user=user,
            day=timezone.now().date(),
        )
        remaining_count = max(0, settings.DAILY_NEW_POST_QUOTA - daily_count.count)
        granted_count = min(wanted_count, remaining_count)
        daily_count.count = daily_count.count + granted_count
        daily_count.save(update_fields=['count'])
    return granted_count


def daily_limit_result(seen_post):
    return {
        'platform': seen_post['platform'],
        'post_id': seen_post['post_id'],
        'status': 'done',
        'action': ACTION_ALLOW,
        'reasons': [],
        'notice': NOTICE_DAILY_LIMIT_REACHED,
    }


# -- Extension endpoints (bearer token) --


@api_view(['GET'])
@authentication_classes([ExtensionTokenAuthentication])
@permission_classes([IsAuthenticated, HasVerifiedEmail, HasAccess])
@throttle_classes([ExtensionConfigThrottle])
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
        'platforms': [PLATFORM_REDDIT, PLATFORM_X, PLATFORM_YOUTUBE],
    })


@api_view(['POST'])
@authentication_classes([ExtensionTokenAuthentication])
@permission_classes([IsAuthenticated, HasVerifiedEmail, HasAccess])
@throttle_classes([ClassifyThrottle])
def classify(request):
    serializer = ClassifyRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    seen_posts = serializer.validated_data['posts']

    # request.auth is the ExtensionToken the request came with.
    ExtensionToken.objects.filter(id=request.auth.id).update(last_classify_request_at=timezone.now())

    settings_for_user(request.user)
    enabled_plugins = UserPlugin.objects.filter(user=request.user, enabled=True).select_related('plugin')
    plugins_to_apply = [(user_plugin, user_plugin.plugin.latest_version()) for user_plugin in enabled_plugins]
    versions = [version for _, version in plugins_to_apply]

    # Posts past the daily quota of new posts are neither stored nor classified.
    new_seen_posts = seen_posts_needing_classification(seen_posts, versions)
    granted_count = take_from_daily_quota(request.user, len(new_seen_posts))
    refused_seen_posts = new_seen_posts[granted_count:]
    refused_keys = {(seen_post['platform'], seen_post['post_id']) for seen_post in refused_seen_posts}

    posts = [
        store_post(seen_post) for seen_post in seen_posts
        if (seen_post['platform'], seen_post['post_id']) not in refused_keys
    ]

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

    results.extend(daily_limit_result(seen_post) for seen_post in refused_seen_posts)
    return Response({'results': results})


# -- Website endpoints (session) --


@api_view(['POST'])
@permission_classes([IsAuthenticated, HasVerifiedEmail])
@throttle_classes([ExtensionTokenThrottle])
def create_extension_token(request):
    raw_token = generate_raw_token()
    ExtensionToken.objects.create(user=request.user, token_hash=hash_token(raw_token))
    return Response({'token': raw_token}, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def onboarding_status(request):
    """Which setup steps the account has done. Installing the extension can
    only be seen by the page itself, or by a connection having been made."""
    email_verified = UserProfile.objects.filter(user=request.user, email_verified=True).exists()
    extension_tokens = ExtensionToken.objects.filter(user=request.user)
    return Response({
        'email_verified': email_verified,
        'extension_connected': extension_tokens.exists(),
        'feed_opened': extension_tokens.filter(last_classify_request_at__isnull=False).exists(),
    })


@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def user_settings_detail(request, user_id=None):
    owner = filters_owner(request, user_id, change=request.method == 'PATCH')
    user_settings = settings_for_user(owner)
    if request.method == 'GET':
        return Response(UserSettingsSerializer(user_settings).data)

    serializer = UserSettingsSerializer(user_settings, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


def enabled_plugin_count(user):
    return UserPlugin.objects.filter(user=user, enabled=True).count()


def enabled_limit_reached_response():
    return Response(
        {'error': ENABLED_PLUGIN_LIMIT_MESSAGE},
        status=status.HTTP_400_BAD_REQUEST,
    )


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def installed_plugin_list(request, user_id=None):
    """GET lists the installed plugins; POST {slug} installs one, turned on."""
    owner = filters_owner(request, user_id, change=request.method == 'POST')
    settings_for_user(owner)

    if request.method == 'POST':
        plugin = get_object_or_404(Plugin, slug=request.data.get('slug', ''), is_listed=True)
        if UserPlugin.objects.filter(user=owner, plugin=plugin).exists():
            return Response({'error': 'This plugin is already installed.'}, status=status.HTTP_400_BAD_REQUEST)
        if enabled_plugin_count(owner) >= MAX_ENABLED_PLUGINS:
            return enabled_limit_reached_response()
        installed_plugin = UserPlugin.objects.create(
            user=owner, plugin=plugin, threshold=plugin.default_threshold)
        return Response(UserPluginSerializer(installed_plugin).data, status=status.HTTP_201_CREATED)

    installed_plugins = UserPlugin.objects.filter(user=owner).select_related('plugin').order_by('plugin__id')
    return Response({
        'plugins': UserPluginSerializer(installed_plugins, many=True).data,
        'enabled_limit': MAX_ENABLED_PLUGINS,
        'can_change': can_change_filters_of(request.user, owner),
    })


@api_view(['PATCH', 'DELETE'])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def installed_plugin_detail(request, slug, user_id=None):
    """PATCH changes enabled, threshold or flagged_action; DELETE uninstalls."""
    owner = filters_owner(request, user_id, change=True)
    settings_for_user(owner)
    installed_plugin = get_object_or_404(
        UserPlugin.objects.select_related('plugin'),
        user=owner,
        plugin__slug=slug,
    )
    if request.method == 'DELETE':
        installed_plugin.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = UserPluginSerializer(installed_plugin, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    turning_on = serializer.validated_data.get('enabled') is True and not installed_plugin.enabled
    if turning_on and enabled_plugin_count(owner) >= MAX_ENABLED_PLUGINS:
        return enabled_limit_reached_response()
    serializer.save()
    return Response(serializer.data)
