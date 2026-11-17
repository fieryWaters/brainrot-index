from django.urls import path

from . import views

urlpatterns = [
    path('store/plugins/', views.store_plugin_list, name='store_plugins'),
    path('store/plugins/<slug:slug>/', views.store_plugin_detail, name='store_plugin'),
    path('store/plugins/<slug:slug>/versions/', views.store_plugin_new_version, name='store_plugin_versions'),
    path('store/plugins/<slug:slug>/rating/', views.store_plugin_rating, name='store_plugin_rating'),
    path('store/plugins/<slug:slug>/report/', views.store_plugin_report, name='store_plugin_report'),
    path('store/try/', views.try_rubric, name='store_try'),
]
