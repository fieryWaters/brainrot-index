from django.contrib import admin
from .models import (
    UserProfile,
    EmailVerificationToken,
    PasswordResetToken,
)


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
