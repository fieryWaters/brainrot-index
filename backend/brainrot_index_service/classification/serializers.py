from rest_framework import serializers

from .models import PLATFORM_CHOICES, POST_KIND_CHOICES, UserPlugin, UserSettings

MAX_POSTS_PER_REQUEST = 25


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
