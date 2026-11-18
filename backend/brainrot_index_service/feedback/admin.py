from django.contrib import admin

from .models import Feedback


@admin.register(Feedback)
class FeedbackAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'created_at', 'resolved', 'user', 'source', 'rating', 'short_text',
        'platform', 'post_id', 'shown_action', 'expected_action', 'site_commit', 'extension_commit',
    ]
    list_filter = ['resolved', 'source', 'rating', 'site_commit', 'expected_action']
    list_editable = ['resolved']
    search_fields = ['text', 'post_id', 'page_url', 'user__email', 'resolved_note']
    date_hierarchy = 'created_at'
    actions = ['mark_resolved']

    @admin.display(description='text')
    def short_text(self, feedback):
        return feedback.text[:100]

    # The fixing commit and a note are added on each report's own page, or with
    # `manage.py resolve_feedback <id> --commit <hash> --note "..."`.
    @admin.action(description='Mark resolved')
    def mark_resolved(self, request, queryset):
        updated = queryset.update(resolved=True)
        self.message_user(request, f"{updated} feedback reports marked resolved.")
