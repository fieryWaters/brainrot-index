"""The extension API (bearer token) and the website's settings endpoints (session)."""

import time
from collections import Counter
from datetime import timedelta

from django.conf import settings
from django.db import connection, transaction
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
    CLASSIFICATION_NOT_APPLICABLE,
    CLASSIFICATION_PENDING,
    MODE_CHILD,
    PLATFORM_REDDIT,
    PLATFORM_X,
    PLATFORM_YOUTUBE,
    PLUGIN_INPUT_VIDEO,
    POST_KIND_REPLY,
    TRANSCRIPT_PENDING,
    Classification,
    ExtensionToken,
    Plugin,
    Post,
    PostImage,
    PostJudgment,
    PostVideo,
    UserPlugin,
    UserSettings,
    VideoTranscript,
)
from .serializers import (
    ClassifyRequestSerializer,
    JudgmentDetailsSerializer,
    JudgmentSerializer,
    UserPluginSerializer,
    UserSettingsSerializer,
)
from .transcripts import TRANSCRIPT_WAIT_SECONDS, store_browser_report
from .video_sources import reddit_video_url_is_allowed, youtube_video_status

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


class JudgmentThrottle(UserRateThrottle):
    scope = 'judgment'


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
    video whose transcript the worker downloads, its pending transcript) the first time."""
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
        # No browser sends transcripts any more, so a video waits for one only
        # when the worker downloads it.
        if post.platform == PLATFORM_YOUTUBE and settings.YOUTUBE_SERVER_TRANSCRIPTS:
            VideoTranscript.objects.create(post=post)
    return post


def store_post_video(post, seen_post):
    """Records the video a page shows in a post, the first time a reader with a
    video filter reports it. A YouTube video is settled at once; a Reddit or X
    video waits for the worker to download its opening. A Reddit playlist off
    Reddit's video host is ignored."""
    if PostVideo.objects.filter(post=post).exists():
        return
    if post.platform == PLATFORM_YOUTUBE:
        video_status, missing_reason = youtube_video_status(post.url, seen_post['video_duration_seconds'])
        PostVideo.objects.get_or_create(post=post, defaults={
            'source_url': post.url,
            'duration_seconds': seen_post['video_duration_seconds'],
            'status': video_status,
            'missing_reason': missing_reason,
            'settled_at': timezone.now(),
        })
        return
    if seen_post['video_url'] == '':
        return
    if post.platform == PLATFORM_REDDIT and not reddit_video_url_is_allowed(seen_post['video_url']):
        return
    PostVideo.objects.get_or_create(post=post, defaults={'source_url': seen_post['video_url']})


def new_classification(post, plugin, plugin_version, post_ids_with_video):
    """A video filter has nothing to judge in a post without a video."""
    if plugin.input_kind == PLUGIN_INPUT_VIDEO and post.id not in post_ids_with_video:
        return Classification(post=post, plugin_version=plugin_version, status=CLASSIFICATION_NOT_APPLICABLE)
    return Classification(post=post, plugin_version=plugin_version)


def record_submissions(user, extension_token, posts):
    """Records that the account sent these posts, in one statement: a new row
    for a post it never sent before, otherwise a later last_seen_at and one
    more times_seen."""
    post_ids = list({post.id for post in posts})
    if not post_ids:
        return
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO classification_postsubmission
                (user_id, post_id, extension_token_id, first_seen_at, last_seen_at, times_seen)
            SELECT %s, sent_post_id, %s, now(), now(), 1
            FROM unnest(%s::bigint[]) AS sent_post_id
            ON CONFLICT (user_id, post_id) DO UPDATE SET
                extension_token_id = EXCLUDED.extension_token_id,
                last_seen_at = EXCLUDED.last_seen_at,
                times_seen = classification_postsubmission.times_seen + 1
            """,
            [user.id, extension_token.id, post_ids],
        )


def posts_wanting_transcripts(posts):
    """The ids of the videos among posts whose transcript a browser may still
    send: pending, and within the wait for one. Empty while the server
    downloads transcripts itself."""
    if settings.YOUTUBE_SERVER_TRANSCRIPTS:
        return set()
    video_ids = [post.id for post in posts if post.platform == PLATFORM_YOUTUBE]
    if not video_ids:
        return set()
    return set(VideoTranscript.objects.filter(
        post_id__in=video_ids,
        status=TRANSCRIPT_PENDING,
        created_at__gt=timezone.now() - timedelta(seconds=TRANSCRIPT_WAIT_SECONDS),
    ).values_list('post_id', flat=True))


def build_results(posts, plugins_to_apply):
    """One result per post. plugins_to_apply is a list of (UserPlugin, PluginVersion).
    A pending video whose transcript is still wanted is marked transcript_wanted."""
    versions = [version for _, version in plugins_to_apply]
    classifications = {
        (classification.post_id, classification.plugin_version_id): classification
        for classification in Classification.objects.filter(post__in=posts, plugin_version__in=versions)
    }
    wanting_transcripts = posts_wanting_transcripts(posts)

    results = []
    for post in posts:
        result = {'platform': post.platform, 'post_id': post.post_id}
        post_classifications = [classifications[(post.id, version.id)] for version in versions]

        if any(classification.status == CLASSIFICATION_PENDING for classification in post_classifications):
            result['status'] = 'pending'
            if post.id in wanting_transcripts:
                result['transcript_wanted'] = True
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


def worth_waiting(results):
    """True while some result is pending and none wants a transcript. A video
    waiting for its transcript is answered at once, so the browser can go and
    fetch it."""
    if any(result.get('transcript_wanted') for result in results):
        return False
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
        # The filters a reader can name when a shown post should have been caught.
        'plugins': [
            {'slug': user_plugin.plugin.slug, 'name': user_plugin.plugin.name}
            for user_plugin in UserPlugin.objects.filter(user=request.user, enabled=True)
            .select_related('plugin').order_by('plugin__id')
        ],
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

    watches_videos = any(user_plugin.plugin.input_kind == PLUGIN_INPUT_VIDEO for user_plugin, _ in plugins_to_apply)
    posts = []
    for seen_post in seen_posts:
        if (seen_post['platform'], seen_post['post_id']) in refused_keys:
            continue
        post = store_post(seen_post)
        if post.platform == PLATFORM_YOUTUBE:
            store_browser_report(post, seen_post)
        if watches_videos:
            store_post_video(post, seen_post)
        posts.append(post)
    record_submissions(request.user, request.auth, posts)

    post_ids_with_video = set()
    if watches_videos:
        post_ids_with_video = set(PostVideo.objects.filter(post__in=posts).values_list('post_id', flat=True))
    # Queue every missing (post, plugin version) pair; existing rows are the cache.
    Classification.objects.bulk_create(
        [
            new_classification(post, user_plugin.plugin, version, post_ids_with_video)
            for post in posts for user_plugin, version in plugins_to_apply
        ],
        ignore_conflicts=True,
    )

    deadline = time.monotonic() + PENDING_WAIT_SECONDS
    results = build_results(posts, plugins_to_apply)
    while worth_waiting(results) and time.monotonic() < deadline:
        time.sleep(PENDING_RECHECK_SECONDS)
        results = build_results(posts, plugins_to_apply)

    results.extend(daily_limit_result(seen_post) for seen_post in refused_seen_posts)
    return Response({'results': results})


def filter_results_for(user, post):
    """What each filter the user has on decided about the post, as stored with
    a judgment. A filter that never classified the post has status missing."""
    filter_results = []
    enabled_plugins = UserPlugin.objects.filter(user=user, enabled=True).select_related('plugin').order_by('plugin__id')
    for user_plugin in enabled_plugins:
        version = user_plugin.plugin.latest_version()
        classification = Classification.objects.filter(post=post, plugin_version=version).first()
        filter_result = {
            'plugin': user_plugin.plugin.slug,
            'version': version.version,
            'threshold': user_plugin.threshold,
            'flagged_action': user_plugin.flagged_action,
            'classification_id': None,
            'status': 'missing',
            'score': None,
            'label': '',
            'flagged': False,
        }
        if classification is not None:
            filter_result['classification_id'] = classification.id
            filter_result['status'] = classification.status
            filter_result['score'] = classification.score
            filter_result['label'] = classification.label
            filter_result['flagged'] = (
                classification.status == CLASSIFICATION_DONE and classification.score >= user_plugin.threshold
            )
        filter_results.append(filter_result)
    return filter_results


def strongest_flagging_plugin(filter_results):
    """The plugin of the highest-scoring filter that flagged the post, or None."""
    flagging_results = [filter_result for filter_result in filter_results if filter_result['flagged']]
    if not flagging_results:
        return None
    strongest = max(flagging_results, key=lambda filter_result: filter_result['score'])
    return Plugin.objects.get(slug=strongest['plugin'])


# A new thumbs up or down replaces the account's earlier judgment of the post,
# including its severity and details, which the reader adds again afterwards.
@api_view(['POST'])
@authentication_classes([ExtensionTokenAuthentication])
@permission_classes([IsAuthenticated, HasVerifiedEmail, HasAccess])
@throttle_classes([JudgmentThrottle])
def create_judgment(request):
    serializer = JudgmentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    judged = serializer.validated_data
    post = get_object_or_404(Post, platform=judged['platform'], post_id=judged['post_id'])
    filter_results = filter_results_for(request.user, post)
    judgment, created = PostJudgment.objects.update_or_create(
        user=request.user,
        post=post,
        defaults={
            'verdict': judged['verdict'],
            'shown_action': judged['shown_action'],
            'plugin': strongest_flagging_plugin(filter_results),
            'severity': '',
            'details': '',
            'filter_results': filter_results,
            'extension_commit': judged['extension_commit'],
        },
    )
    if created:
        response_status = status.HTTP_201_CREATED
    else:
        response_status = status.HTTP_200_OK
    return Response({'id': judgment.id}, status=response_status)


@api_view(['PATCH'])
@authentication_classes([ExtensionTokenAuthentication])
@permission_classes([IsAuthenticated, HasVerifiedEmail, HasAccess])
@throttle_classes([JudgmentThrottle])
def judgment_details(request, judgment_id):
    judgment = get_object_or_404(PostJudgment, id=judgment_id, user=request.user)
    serializer = JudgmentDetailsSerializer(judgment, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(serializer.data)


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
