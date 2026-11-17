from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from classification.models import Plugin


class PluginRating(models.Model):
    """One user's 1 to 5 star rating of a plugin they installed, with an optional short review."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='plugin_ratings')
    plugin = models.ForeignKey(Plugin, on_delete=models.PROTECT, related_name='ratings')
    stars = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    review = models.CharField(max_length=500, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'plugin'], name='one_rating_per_user_per_plugin'),
        ]

    def __str__(self):
        return f"{self.stars} stars for {self.plugin} by {self.user}"


class PluginReport(models.Model):
    """A user's report that a plugin is abusive or broken, for the admin to review."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='plugin_reports')
    plugin = models.ForeignKey(Plugin, on_delete=models.PROTECT, related_name='reports')
    reason = models.CharField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"report on {self.plugin} by {self.user}"
