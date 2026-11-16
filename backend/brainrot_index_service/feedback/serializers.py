from rest_framework import serializers

from .models import Feedback


class FeedbackSerializer(serializers.ModelSerializer):
    class Meta:
        model = Feedback
        fields = [
            'source', 'text', 'page_url', 'extension_commit',
            'platform', 'post_id', 'shown_action', 'expected_action',
        ]

    def validate(self, data):
        if not data.get('text', '').strip() and not data.get('expected_action'):
            raise serializers.ValidationError('Give text, an expected_action, or both.')
        return data
