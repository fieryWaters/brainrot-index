from rest_framework import serializers

from .models import Feedback


class FeedbackSerializer(serializers.ModelSerializer):
    class Meta:
        model = Feedback
        # Older feedback also holds platform, post_id, shown_action and expected_action, sent by
        # the extension's right-click report before thumbs replaced it.
        fields = ['source', 'rating', 'text', 'page_url', 'reply_email', 'extension_commit']

    def validate(self, data):
        if not data.get('text', '').strip() and not data.get('rating'):
            raise serializers.ValidationError('Give a rating, text, or both.')
        return data


class ContactSerializer(serializers.Serializer):
    """A message from the contact form. The email is where the owner replies."""

    name = serializers.CharField(max_length=100, allow_blank=True, default='')
    email = serializers.EmailField()
    subject = serializers.CharField(max_length=200)
    message = serializers.CharField()


class ResolveSerializer(serializers.Serializer):
    """What fixed an inbox item. Some items need no fix and some need no
    explanation, so the commit and the note may be blank."""

    commit = serializers.CharField(max_length=64, allow_blank=True, default='')
    note = serializers.CharField(allow_blank=True, default='')
