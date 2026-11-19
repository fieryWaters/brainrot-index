from django.urls import path

from . import views

urlpatterns = [
    path('feedback/', views.create_feedback, name='create_feedback'),
    path('contact/', views.create_contact_message, name='create_contact_message'),
    path('inbox/', views.list_inbox, name='list_inbox'),
    path('inbox/<str:item_id>/', views.inbox_item, name='inbox_item'),
    path('inbox/<str:item_id>/resolve/', views.resolve_inbox_item, name='resolve_inbox_item'),
]
