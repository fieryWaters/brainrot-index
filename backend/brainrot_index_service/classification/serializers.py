from rest_framework import serializers

from .models import (
    PLATFORM_CHOICES,
    POST_KIND_CHOICES,
    SHOULD_BE_BLOCKED,
    SHOULD_BE_SHOWN,
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


class QuotedPostSerializer(serializers.Serializer):
    """Another post shown inside the seen one: an X quote or a Reddit crosspost."""

    author = serializers.CharField(max_length=255, allow_blank=True, default='')
    url = serializers.CharField(allow_blank=True, default='')
    text = serializers.CharField(allow_blank=True, default='', trim_whitespace=False)


class LinkPreviewSerializer(serializers.Serializer):
    """The preview of a linked page: an X card or a Reddit link post. text is every line it shows."""

    url = serializers.CharField(allow_blank=True, default='')
    domain = serializers.CharField(max_length=255, allow_blank=True, default='')
    text = serializers.CharField(allow_blank=True, default='', trim_whitespace=False)


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
    # Where the page plays the post's video: a Reddit post's HLS playlist, or an X post's own URL.
    # Blank for a post without a video, and for YouTube, whose every post is a video.
    video_url = serializers.CharField(allow_blank=True, default='')
    # Null when the post shows none, as in older extensions.
    quoted_post = QuotedPostSerializer(allow_null=True, default=None)
    link_preview = LinkPreviewSerializer(allow_null=True, default=None)
    # A YouTube video's length as its tile shows it. Null when the tile shows none, as for Shorts.
    video_duration_seconds = serializers.IntegerField(min_value=0, allow_null=True, default=None)


class ClassifyRequestSerializer(serializers.Serializer):
    posts = SeenPostSerializer(many=True, max_length=MAX_POSTS_PER_REQUEST)


class DataConsentSerializer(serializers.Serializer):
    """The person's agreement on the extension's consent screen."""

    disclosure_version = serializers.CharField(max_length=32)
    agreed_at = serializers.DateTimeField()


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
    """What the reader adds after the click: the label (should be shown, or
    should be blocked as a filter, or as Other when no filter is named), a
    severity and details. Naming a filter alone means blocked as it."""

    plugin = serializers.SlugRelatedField(slug_field='slug', queryset=Plugin.objects.all(), allow_null=True)

    class Meta:
        model = PostJudgment
        fields = ['should_be', 'plugin', 'severity', 'details']

    def validate(self, attrs):
        if attrs.get('plugin') is not None and 'should_be' not in attrs:
            attrs['should_be'] = SHOULD_BE_BLOCKED
        if attrs.get('should_be') == SHOULD_BE_SHOWN:
            attrs['plugin'] = None
        return attrs
