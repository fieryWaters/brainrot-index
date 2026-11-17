from django.urls import path

from . import views

urlpatterns = [
    path('family/', views.family_detail, name='family'),
    path('family/invites/', views.create_invite, name='family_invites'),
    path('family/invites/<int:invite_id>/revoke/', views.revoke_invite, name='family_invite_revoke'),
    path('family/invites/preview/', views.preview_invite, name='family_invite_preview'),
    path('family/join/', views.join_family, name='family_join'),
    path('family/leave/', views.leave_family, name='family_leave'),
    path('family/members/<int:user_id>/', views.family_member_detail, name='family_member'),
]
