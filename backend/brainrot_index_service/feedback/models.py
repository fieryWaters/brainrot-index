from django.conf import settings
from django.db import models

from classification.models import ACTION_ALLOW, ACTION_BLUR, ACTION_HIDE, PLATFORM_CHOICES, PostJudgment

SOURCE_SITE = 'site'
SOURCE_EXTENSION = 'extension'
SOURCE_CONTACT = 'contact'
SOURCE_CHOICES = [
    (SOURCE_SITE, 'Website'),
    (SOURCE_EXTENSION, 'Extension'),
    (SOURCE_CONTACT, 'Contact form'),
]

RATING_UP = 'up'
RATING_DOWN = 'down'
RATING_CHOICES = [
    (RATING_UP, 'Thumbs up'),
    (RATING_DOWN, 'Thumbs down'),
]

ACTION_CHOICES = [
    (ACTION_ALLOW, 'Allow'),
    (ACTION_BLUR, 'Blur'),
    (ACTION_HIDE, 'Hide'),
]


class Feedback(models.Model):
    """A problem report written while using the product, stamped with the code
    versions it was written against so fixed reports can be told apart."""

    # Empty for a report sent from the website by someone not signed in.
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='feedback', null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    source = models.CharField(max_length=16, choices=SOURCE_CHOICES)
    # A thumbs up or down from the website's feedback button; the text is optional with it.
    rating = models.CharField(max_length=8, choices=RATING_CHOICES, blank=True, default='')
    text = models.TextField(blank=True, default='')
    page_url = models.TextField(blank=True, default='')
    # Where to answer someone not signed in, if they gave an address. Always
    # given with the contact form, signed in or not.
    reply_email = models.EmailField(blank=True, default='')
    # The contact form's optional name and its subject line.
    name = models.CharField(max_length=100, blank=True, default='')
    subject = models.CharField(max_length=200, blank=True, default='')
    site_commit = models.CharField(max_length=64)
    extension_commit = models.CharField(max_length=64, blank=True, default='')

    # The post the feedback is about, if any.
    platform = models.CharField(max_length=16, choices=PLATFORM_CHOICES, blank=True, default='')
    post_id = models.CharField(max_length=128, blank=True, default='')
    shown_action = models.CharField(max_length=16, choices=ACTION_CHOICES, blank=True, default='')
    expected_action = models.CharField(max_length=16, choices=ACTION_CHOICES, blank=True, default='')

    # Set once the problem is fixed, naming the commit that fixed it, so open reports are easy to find.
    resolved = models.BooleanField(default=False)
    resolved_commit = models.CharField(max_length=64, blank=True, default='')
    resolved_note = models.TextField(blank=True, default='')

    class Meta:
        verbose_name_plural = 'feedback'

    def __str__(self):
        sender = self.user if self.user is not None else "someone not signed in"
        return f"feedback {self.id} from {sender} ({self.source})"


class JudgmentResolution(models.Model):
    """The owner's note that a reader's thumbs up or down has been dealt with.
    Kept beside the judgment rather than on it, since the judgment is the
    reader's own record. A reader who judges the post again, or adds details,
    updates the judgment after it was resolved, and that opens it again."""

    judgment = models.OneToOneField(PostJudgment, on_delete=models.CASCADE, related_name='resolution')
    resolved_commit = models.CharField(max_length=64, blank=True, default='')
    resolved_note = models.TextField()
    resolved_at = models.DateTimeField(auto_now=True)

    def covers_current_judgment(self):
        return self.resolved_at >= self.judgment.updated_at

    def __str__(self):
        return f"resolution of judgment {self.judgment_id}"
