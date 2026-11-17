from rest_framework import serializers

from classification.models import PLATFORM_CHOICES, PLATFORM_REDDIT, Plugin

MAX_RUBRIC_CHARACTERS = 4000
MAX_TRY_TEXT_CHARACTERS = 4000


def rubric_field():
    return serializers.CharField(min_length=50, max_length=MAX_RUBRIC_CHARACTERS)


class PublishPluginSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=3, max_length=60)
    description = serializers.CharField(min_length=10, max_length=300)
    author_name = serializers.CharField(min_length=1, max_length=60)
    rubric = rubric_field()
    default_threshold = serializers.IntegerField(min_value=0, max_value=100, default=60)

    def validate_name(self, name):
        if Plugin.objects.filter(name__iexact=name).exists():
            raise serializers.ValidationError('A plugin with this name already exists.')
        return name


class NewVersionSerializer(serializers.Serializer):
    rubric = rubric_field()


class TryRubricSerializer(serializers.Serializer):
    rubric = rubric_field()
    text = serializers.CharField(min_length=1, max_length=MAX_TRY_TEXT_CHARACTERS, trim_whitespace=False)
    platform = serializers.ChoiceField(choices=PLATFORM_CHOICES, default=PLATFORM_REDDIT)


class RatingSerializer(serializers.Serializer):
    stars = serializers.IntegerField(min_value=1, max_value=5)
    review = serializers.CharField(max_length=500, allow_blank=True, default='')


class ReportSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=5, max_length=500)
