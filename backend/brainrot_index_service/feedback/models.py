from django.conf import settings
from django.db import models

from classification.models import ACTION_ALLOW, ACTION_BLUR, ACTION_HIDE, PLATFORM_CHOICES

SOURCE_SITE = 'site'
SOURCE_EXTENSION = 'extension'
SOURCE_CHOICES = [
    (SOURCE_SITE, 'Website'),
    (SOURCE_EXTENSION, 'Extension'),
]

ACTION_CHOICES = [
    (ACTION_ALLOW, 'Allow'),
    (ACTION_BLUR, 'Blur'),
    (ACTION_HIDE, 'Hide'),
]


class Feedback(models.Model):
    """A problem report written while using the product, stamped with the code
    versions it was written against so fixed reports can be told apart."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='feedback')
    created_at = models.DateTimeField(auto_now_add=True)
    source = models.CharField(max_length=16, choices=SOURCE_CHOICES)
    text = models.TextField(blank=True, default='')
    page_url = models.TextField(blank=True, default='')
    site_commit = models.CharField(max_length=64)
    extension_commit = models.CharField(max_length=64, blank=True, default='')

    # The post the feedback is about, if any.
    platform = models.CharField(max_length=16, choices=PLATFORM_CHOICES, blank=True, default='')
    post_id = models.CharField(max_length=128, blank=True, default='')
    shown_action = models.CharField(max_length=16, choices=ACTION_CHOICES, blank=True, default='')
    expected_action = models.CharField(max_length=16, choices=ACTION_CHOICES, blank=True, default='')

    class Meta:
        verbose_name_plural = 'feedback'

    def __str__(self):
        return f"feedback {self.id} from {self.user} ({self.source})"
