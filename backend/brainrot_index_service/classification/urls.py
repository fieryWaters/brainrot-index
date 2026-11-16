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
]
