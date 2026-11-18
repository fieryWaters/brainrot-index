from rest_framework import serializers

from .models import Feedback


class FeedbackSerializer(serializers.ModelSerializer):
    class Meta:
        model = Feedback
        fields = [
            'source', 'rating', 'text', 'page_url', 'reply_email', 'extension_commit',
            'platform', 'post_id', 'shown_action', 'expected_action',
        ]

    def validate(self, data):
        if not data.get('text', '').strip() and not data.get('expected_action') and not data.get('rating'):
            raise serializers.ValidationError('Give a rating, text, an expected_action, or more than one.')
        return data
