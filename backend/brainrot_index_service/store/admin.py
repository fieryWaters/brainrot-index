from django.contrib import admin

from .models import PluginRating, PluginReport


@admin.register(PluginRating)
class PluginRatingAdmin(admin.ModelAdmin):
    list_display = ['plugin', 'user', 'stars', 'review', 'updated_at']
    list_filter = ['plugin', 'stars']
    search_fields = ['user__email', 'review']


@admin.register(PluginReport)
class PluginReportAdmin(admin.ModelAdmin):
    """To act on a report, unlist the plugin on its Plugin page."""

    list_display = ['plugin', 'user', 'reason', 'created_at']
    list_filter = ['plugin']
    search_fields = ['user__email', 'reason', 'plugin__name']
    date_hierarchy = 'created_at'
