"""The plugin store: browse, publish, try, rate and report plugins.
Installing and uninstalling go through /api/plugins/, with the other
per-account plugin settings."""

from django.conf import settings
from django.db import transaction
from django.db.models import Avg, Count, IntegerField, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils.text import slugify
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.permissions import HasVerifiedEmail
from api.throttling import ChangeRateThrottle, UserRateThrottle
from billing.permissions import HasAccess
from classification.inference import ask_model, build_messages, configured_model, describe_post
from classification.models import (
    CLASSIFICATION_DONE,
    POST_KIND_POST,
    Classification,
    Plugin,
    PluginVersion,
    UserPlugin,
)
from classification.views import take_from_daily_quota
from families.permissions import require_not_child

from .models import PluginRating, PluginReport
from .rubric import PUBLISHED_PLUGIN_LABELS, framed_rubric
from .serializers import (
    NewVersionSerializer,
    PublishPluginSerializer,
    RatingSerializer,
    ReportSerializer,
    TryRubricSerializer,
)

SAMPLE_CLASSIFICATIONS_SHOWN = 3
SAMPLE_TEXT_CHARACTERS = 280
REVIEWS_SHOWN = 5

CHILD_CANNOT_PUBLISH_MESSAGE = 'Child accounts cannot publish plugins.'
CHILD_CANNOT_RATE_MESSAGE = 'Child accounts cannot rate plugins.'


class TryRubricThrottle(UserRateThrottle):
    scope = 'store_try'


class PublishThrottle(ChangeRateThrottle):
    scope = 'store_publish'


class ReviewThrottle(UserRateThrottle):
    scope = 'store_review'


# Publishing needs a verified email; browsing needs only a session.
class VerifiedEmailToChange(HasVerifiedEmail):
    def has_permission(self, request, view):
        if request.method == 'GET':
            return True
        return super().has_permission(request, view)


def with_store_counts(plugins):
    # Subqueries instead of joins, so installs and ratings do not multiply each other's rows.
    install_counts = (
        UserPlugin.objects.filter(plugin=OuterRef('pk'))
        .values('plugin').annotate(count=Count('id')).values('count')
    )
    rating_counts = (
        PluginRating.objects.filter(plugin=OuterRef('pk'))
        .values('plugin').annotate(count=Count('id')).values('count')
    )
    average_ratings = (
        PluginRating.objects.filter(plugin=OuterRef('pk'))
        .values('plugin').annotate(average=Avg('stars')).values('average')
    )
    return plugins.annotate(
        install_count=Coalesce(Subquery(install_counts, output_field=IntegerField()), Value(0)),
        rating_count=Coalesce(Subquery(rating_counts, output_field=IntegerField()), Value(0)),
        average_rating=Subquery(average_ratings),
    )


def author_name_of(plugin):
    if plugin.is_baseline:
        return 'Brainrot Index'
    return plugin.author_name


def plugin_summary(plugin, installed_plugin_ids):
    if plugin.average_rating is None:
        average_rating = None
    else:
        average_rating = round(float(plugin.average_rating), 1)
    return {
        'slug': plugin.slug,
        'name': plugin.name,
        'description': plugin.description,
        'author_name': author_name_of(plugin),
        'is_baseline': plugin.is_baseline,
        'is_listed': plugin.is_listed,
        'suggested_for_children': plugin.suggested_for_children,
        'install_count': plugin.install_count,
        'rating_count': plugin.rating_count,
        'average_rating': average_rating,
        'installed': plugin.id in installed_plugin_ids,
    }


def installed_plugin_ids_of(user):
    return set(UserPlugin.objects.filter(user=user).values_list('plugin_id', flat=True))


def visible_plugin(request, slug):
    """A listed plugin, or an unlisted one the user wrote or still has installed."""
    plugin = get_object_or_404(with_store_counts(Plugin.objects.all()), slug=slug)
    if plugin.is_listed or plugin.author_id == request.user.id:
        return plugin
    if UserPlugin.objects.filter(user=request.user, plugin=plugin).exists():
        return plugin
    raise Http404


def sample_classifications(plugin_version):
    classifications = (
        Classification.objects
        .filter(plugin_version=plugin_version, status=CLASSIFICATION_DONE)
        .select_related('post')
        .order_by('-completed_at')[:SAMPLE_CLASSIFICATIONS_SHOWN]
    )
    return [
        {
            'platform': classification.post.platform,
            'text': classification.post.text[:SAMPLE_TEXT_CHARACTERS],
            'score': classification.score,
            'label': classification.label,
            'reasoning': classification.reasoning,
        }
        for classification in classifications
    ]


def unique_slug(name):
    base_slug = slugify(name)[:40] or 'plugin'
    slug = base_slug
    suffix = 2
    while Plugin.objects.filter(slug=slug).exists():
        slug = f"{base_slug}-{suffix}"
        suffix += 1
    return slug


def publish_version(plugin, author_rubric, version_number):
    return PluginVersion.objects.create(
        plugin=plugin,
        version=version_number,
        rubric_prompt=framed_rubric(author_rubric),
        author_rubric=author_rubric.strip(),
        allowed_labels=PUBLISHED_PLUGIN_LABELS,
    )


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated, VerifiedEmailToChange])
@throttle_classes([PublishThrottle])
def store_plugin_list(request):
    """GET lists the store, filtered by ?q=; POST publishes a new plugin."""
    if request.method == 'POST':
        require_not_child(request.user, CHILD_CANNOT_PUBLISH_MESSAGE)
        serializer = PublishPluginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        fields = serializer.validated_data
        with transaction.atomic():
            plugin = Plugin.objects.create(
                slug=unique_slug(fields['name']),
                name=fields['name'],
                description=fields['description'],
                author=request.user,
                author_name=fields['author_name'],
                default_threshold=fields['default_threshold'],
            )
            publish_version(plugin, fields['rubric'], 1)
        return Response({'slug': plugin.slug}, status=status.HTTP_201_CREATED)

    plugins = Plugin.objects.filter(is_listed=True)
    query = request.query_params.get('q', '').strip()
    if query:
        plugins = plugins.filter(
            Q(name__icontains=query) | Q(description__icontains=query) | Q(author_name__icontains=query))
    plugins = with_store_counts(plugins).order_by('-install_count', 'name')
    installed_plugin_ids = installed_plugin_ids_of(request.user)
    return Response({'plugins': [plugin_summary(plugin, installed_plugin_ids) for plugin in plugins]})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
@throttle_classes([])
def store_plugin_detail(request, slug):
    plugin = visible_plugin(request, slug)
    latest_version = plugin.latest_version()

    my_rating = PluginRating.objects.filter(user=request.user, plugin=plugin).first()
    if my_rating is None:
        my_rating_data = None
    else:
        my_rating_data = {'stars': my_rating.stars, 'review': my_rating.review}

    reviews = PluginRating.objects.filter(plugin=plugin).exclude(review='').order_by('-updated_at')[:REVIEWS_SHOWN]

    detail = plugin_summary(plugin, installed_plugin_ids_of(request.user))
    detail.update({
        'rubric': latest_version.displayed_rubric(),
        'version': latest_version.version,
        'default_threshold': plugin.default_threshold,
        'is_author': plugin.author_id == request.user.id,
        'my_rating': my_rating_data,
        'reviews': [
            {'stars': rating.stars, 'review': rating.review, 'date': rating.updated_at.date().isoformat()}
            for rating in reviews
        ],
        'samples': sample_classifications(latest_version),
    })
    return Response(detail)


@api_view(['POST'])
@permission_classes([IsAuthenticated, HasVerifiedEmail])
@throttle_classes([PublishThrottle])
def store_plugin_new_version(request, slug):
    """Publishes a new rubric version. Earlier versions and their cached classifications stay as they were."""
    require_not_child(request.user, CHILD_CANNOT_PUBLISH_MESSAGE)
    serializer = NewVersionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    with transaction.atomic():
        plugin = get_object_or_404(Plugin.objects.select_for_update(), slug=slug, author=request.user)
        version = publish_version(plugin, serializer.validated_data['rubric'], plugin.latest_version().version + 1)
    return Response({'version': version.version}, status=status.HTTP_201_CREATED)


@api_view(['PUT'])
@permission_classes([IsAuthenticated, HasVerifiedEmail])
@throttle_classes([ReviewThrottle])
def store_plugin_rating(request, slug):
    require_not_child(request.user, CHILD_CANNOT_RATE_MESSAGE)
    plugin = visible_plugin(request, slug)
    if not UserPlugin.objects.filter(user=request.user, plugin=plugin).exists():
        return Response({'error': 'Install a plugin before rating it.'}, status=status.HTTP_400_BAD_REQUEST)

    serializer = RatingSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    PluginRating.objects.update_or_create(user=request.user, plugin=plugin, defaults=serializer.validated_data)
    return Response(serializer.validated_data)


@api_view(['POST'])
@permission_classes([IsAuthenticated, HasVerifiedEmail])
@throttle_classes([ReviewThrottle])
def store_plugin_report(request, slug):
    plugin = visible_plugin(request, slug)
    serializer = ReportSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    PluginReport.objects.create(user=request.user, plugin=plugin, reason=serializer.validated_data['reason'])
    return Response(status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated, HasVerifiedEmail, HasAccess])
@throttle_classes([TryRubricThrottle])
def try_rubric(request):
    """Scores pasted post text with a draft rubric, exactly as a published version would.
    Each try is one model call, so it also counts as one new post against the daily quota."""
    require_not_child(request.user, CHILD_CANNOT_PUBLISH_MESSAGE)
    serializer = TryRubricSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    fields = serializer.validated_data
    if take_from_daily_quota(request.user, 1) == 0:
        return Response(
            {'error': "You have reached today's limit of posts checked. Please try again tomorrow."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    draft_version = PluginVersion(
        rubric_prompt=framed_rubric(fields['rubric']), allowed_labels=PUBLISHED_PLUGIN_LABELS)
    post_description = describe_post(fields['platform'], '', POST_KIND_POST, fields['text'], None, 0)
    messages = build_messages(draft_version, post_description, [])
    outcome = ask_model(messages, PUBLISHED_PLUGIN_LABELS, settings.INFERENCE_SOURCE, configured_model())
    if outcome.answer is None:
        return Response(
            {'error': 'The model did not give an answer. Please try again.'},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response(outcome.answer)
