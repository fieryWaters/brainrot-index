from django.urls import path

from . import views

urlpatterns = [
    path('tuning/filters/', views.list_filters, name='tuning_filters'),
    path('tuning/experiments/', views.experiments, name='tuning_experiments'),
    path('tuning/experiments/<int:experiment_id>/', views.experiment_detail, name='tuning_experiment'),
    path('tuning/thumbs/<int:judgment_id>/', views.thumb_detail, name='tuning_thumb'),
]
