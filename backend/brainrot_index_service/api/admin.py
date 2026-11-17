from django.contrib import admin
from .models import (
    DailyNewPostCount,
    InviteCode,
    UserProfile,
    EmailVerificationToken,
    PasswordResetToken,
)


@admin.register(InviteCode)
class InviteCodeAdmin(admin.ModelAdmin):
    list_display = ['code', 'note', 'uses', 'max_uses', 'active', 'created']
    list_filter = ['active']
    search_fields = ['code', 'note']
    readonly_fields = ['uses', 'created']


@admin.register(DailyNewPostCount)
class DailyNewPostCountAdmin(admin.ModelAdmin):
    list_display = ['user', 'day', 'count']
    list_filter = ['day']
    search_fields = ['user__email']


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'auth_provider', 'email_verified', 'created_at']
    list_filter = ['auth_provider', 'email_verified']
    search_fields = ['user__username', 'user__email']


@admin.register(EmailVerificationToken)
class EmailVerificationTokenAdmin(admin.ModelAdmin):
    list_display = ['user', 'created_at', 'expires_at', 'consumed_at']
    search_fields = ['user__username', 'user__email']


@admin.register(PasswordResetToken)
class PasswordResetTokenAdmin(admin.ModelAdmin):
    list_display = ['user', 'created_at', 'expires_at', 'consumed_at']
    search_fields = ['user__username', 'user__email']
