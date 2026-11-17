from rest_framework import serializers

from .models import (
    PLATFORM_CHOICES,
    POST_KIND_CHOICES,
    SHOWN_ACTION_CHOICES,
    VERDICT_CHOICES,
    Plugin,
    PostJudgment,
    UserPlugin,
    UserSettings,
)

MAX_POSTS_PER_REQUEST = 25
# A browser sends at most the first 2500 words of a transcript; this leaves room
# for long words and is cut again when stored.
MAX_TRANSCRIPT_CHARACTERS = 30000

TRANSCRIPT_KIND_MANUAL = 'manual'
TRANSCRIPT_KIND_AUTO = 'auto'
TRANSCRIPT_REPORT_OK = 'ok'
TRANSCRIPT_REPORT_NONE = 'none'
TRANSCRIPT_REPORT_FAILED = 'failed'


class SeenPostSerializer(serializers.Serializer):
    """A post or reply as the extension saw it in the feed."""

    platform = serializers.ChoiceField(choices=PLATFORM_CHOICES)
    kind = serializers.ChoiceField(choices=POST_KIND_CHOICES)
    parent_post_id = serializers.CharField(max_length=128, allow_blank=True, default='')
    post_id = serializers.CharField(max_length=128)
    url = serializers.CharField(allow_blank=True, default='')
    author = serializers.CharField(max_length=255, allow_blank=True, default='')
    community = serializers.CharField(max_length=255, allow_blank=True, default='')
    text = serializers.CharField(allow_blank=True, default='', trim_whitespace=False)
    # Blank entries are accepted here and dropped by store_post with the other unusable URLs.
    image_urls = serializers.ListField(child=serializers.CharField(allow_blank=True), default=list)
    # For a YouTube video, what the reader's browser found when it fetched the captions:
    # ok with the transcript, none when the video has no captions, failed when it could not tell.
    # Blank when the browser did not report, as in older extensions and every first send.
    transcript_status = serializers.ChoiceField(
        choices=[TRANSCRIPT_REPORT_OK, TRANSCRIPT_REPORT_NONE, TRANSCRIPT_REPORT_FAILED],
        allow_blank=True, default='')
    transcript = serializers.CharField(
        max_length=MAX_TRANSCRIPT_CHARACTERS, allow_blank=True, default='', trim_whitespace=False)
    transcript_language = serializers.CharField(max_length=16, allow_blank=True, default='')
    transcript_kind = serializers.ChoiceField(
        choices=[TRANSCRIPT_KIND_MANUAL, TRANSCRIPT_KIND_AUTO], allow_blank=True, default='')


class ClassifyRequestSerializer(serializers.Serializer):
    posts = SeenPostSerializer(many=True, max_length=MAX_POSTS_PER_REQUEST)


class UserSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserSettings
        fields = ['enabled', 'mode', 'allow_reveal']


class UserPluginSerializer(serializers.ModelSerializer):
    slug = serializers.CharField(source='plugin.slug', read_only=True)
    name = serializers.CharField(source='plugin.name', read_only=True)
    description = serializers.CharField(source='plugin.description', read_only=True)

    class Meta:
        model = UserPlugin
        fields = ['slug', 'name', 'description', 'enabled', 'threshold', 'flagged_action']


class JudgmentSerializer(serializers.Serializer):
    """A thumbs up or down on a post the extension answered for."""

    platform = serializers.ChoiceField(choices=PLATFORM_CHOICES)
    post_id = serializers.CharField(max_length=128)
    verdict = serializers.ChoiceField(choices=VERDICT_CHOICES)
    shown_action = serializers.ChoiceField(choices=SHOWN_ACTION_CHOICES)
    extension_commit = serializers.CharField(max_length=64, allow_blank=True, default='')


class JudgmentDetailsSerializer(serializers.ModelSerializer):
    """What the reader adds after the click: a severity, details, and the filter it is about."""

    plugin = serializers.SlugRelatedField(slug_field='slug', queryset=Plugin.objects.all(), allow_null=True)

    class Meta:
        model = PostJudgment
        fields = ['severity', 'details', 'plugin']
