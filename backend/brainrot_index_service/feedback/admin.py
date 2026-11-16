from django.contrib import admin

from .models import Feedback


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'created_at', 'user', 'source', 'short_text',
        'platform', 'post_id', 'shown_action', 'expected_action', 'site_commit', 'extension_commit',
    ]
    list_filter = ['source', 'site_commit', 'expected_action']
    search_fields = ['text', 'post_id', 'page_url', 'user__email']
    date_hierarchy = 'created_at'

    @admin.display(description='text')
    def short_text(self, feedback):
        return feedback.text[:100]
