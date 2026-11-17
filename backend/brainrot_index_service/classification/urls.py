from django.urls import path

from . import views

urlpatterns = [
    # Browser extension (bearer token)
    path('extension/config/', views.extension_config, name='extension_config'),
    path('classify/', views.classify, name='classify'),

    # Website (session)
    path('extension/token/', views.create_extension_token, name='create_extension_token'),
    path('settings/', views.user_settings_detail, name='user_settings'),
    path('plugins/', views.installed_plugin_list, name='installed_plugins'),
    path('plugins/<slug:slug>/', views.installed_plugin_detail, name='installed_plugin'),

    # The same, for a member of the signed-in user's family
    path('family/members/<int:user_id>/settings/', views.user_settings_detail, name='member_settings'),
    path('family/members/<int:user_id>/plugins/', views.installed_plugin_list, name='member_plugins'),
    path('family/members/<int:user_id>/plugins/<slug:slug>/', views.installed_plugin_detail, name='member_plugin'),
]
