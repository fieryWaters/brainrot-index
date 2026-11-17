from django.contrib import admin

from .models import Family, FamilyInvite, FamilyMember


class FamilyMemberInline(admin.TabularInline):
    model = FamilyMember
    extra = 0
    fields = ['user', 'role', 'joined_at']
    readonly_fields = ['joined_at']
    raw_id_fields = ['user']


@admin.register(Family)
class FamilyAdmin(admin.ModelAdmin):
    list_display = ['name', 'created_by', 'created_at']
    search_fields = ['name', 'members__user__email']
    inlines = [FamilyMemberInline]


@admin.register(FamilyInvite)
class FamilyInviteAdmin(admin.ModelAdmin):
    list_display = ['id', 'family', 'role', 'created_by', 'created_at', 'expires_at', 'accepted_by', 'revoked_at']
    list_filter = ['role']
    readonly_fields = ['code_hash']
