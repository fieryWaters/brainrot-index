from django.contrib import admin

from .models import (
    Classification,
    ExtensionToken,
    Plugin,
    PluginVersion,
    Post,
    PostImage,
    UserPlugin,
    UserSettings,
)


class PostImageInline(admin.TabularInline):
    model = PostImage
    extra = 0
    fields = ['source_url', 'status', 'byte_size', 'file']
    readonly_fields = fields


@admin.register(Post)
class PostAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'kind', 'community', 'author', 'short_text', 'first_seen_at']
    list_filter = ['platform', 'kind']
    search_fields = ['post_id', 'parent_post_id', 'author', 'community', 'text']
    date_hierarchy = 'first_seen_at'
    inlines = [PostImageInline]

    @admin.display(description='text')
    def short_text(self, post):
        return post.text[:100]


@admin.register(PostImage)
class PostImageAdmin(admin.ModelAdmin):
    list_display = ['id', 'post', 'status', 'byte_size', 'source_url', 'created_at']
    list_filter = ['status']
    search_fields = ['source_url', 'post__post_id']
    raw_id_fields = ['post']


class PluginVersionInline(admin.TabularInline):
    model = PluginVersion
    extra = 0
    fields = ['version', 'allowed_labels', 'created_at']
    readonly_fields = fields
    show_change_link = True


@admin.register(Plugin)
class PluginAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'is_baseline', 'is_listed', 'author_name', 'author', 'created_at']
    list_filter = ['is_baseline', 'is_listed']
    search_fields = ['name', 'slug', 'author_name']
    inlines = [PluginVersionInline]
    actions = ['unlist']

    @admin.action(description='Unlist from the store')
    def unlist(self, request, plugins):
        plugins.update(is_listed=False)


@admin.register(PluginVersion)
class PluginVersionAdmin(admin.ModelAdmin):
    list_display = ['plugin', 'version', 'created_at']
    list_filter = ['plugin']

    # Saved versions are immutable: cached classifications depend on their exact text.
    def has_change_permission(self, request, plugin_version=None):
        return plugin_version is None


@admin.register(Classification)
class ClassificationAdmin(admin.ModelAdmin):
    list_display = [
        'id', 'post', 'plugin_version', 'status', 'score', 'label',
        'model', 'latency_ms', 'prompt_tokens', 'completion_tokens', 'created_at',
    ]
    list_filter = ['status', 'plugin_version__plugin', 'label', 'model', 'inference_source']
    search_fields = ['post__post_id', 'post__text', 'reasoning']
    date_hierarchy = 'created_at'
    raw_id_fields = ['post']


@admin.register(UserPlugin)
class UserPluginAdmin(admin.ModelAdmin):
    list_display = ['user', 'plugin', 'enabled', 'threshold', 'flagged_action', 'installed_at']
    list_filter = ['plugin', 'enabled', 'flagged_action']
    search_fields = ['user__email']


@admin.register(UserSettings)
class UserSettingsAdmin(admin.ModelAdmin):
    list_display = ['user', 'enabled', 'mode', 'allow_reveal']
    list_filter = ['enabled', 'mode', 'allow_reveal']
    search_fields = ['user__email']


@admin.register(ExtensionToken)
class ExtensionTokenAdmin(admin.ModelAdmin):
    list_display = ['id', 'user', 'created_at', 'last_used_at']
    search_fields = ['user__email']
    readonly_fields = ['token_hash']
