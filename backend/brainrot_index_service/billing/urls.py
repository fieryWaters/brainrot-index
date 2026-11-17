from django.urls import path

from . import views

urlpatterns = [
    path('billing/', views.billing_status, name='billing_status'),
    path('billing/checkout/', views.create_checkout_session, name='billing_checkout'),
    path('billing/checkout/reconcile/', views.reconcile_checkout_session, name='billing_checkout_reconcile'),
    path('billing/portal/', views.create_portal_session, name='billing_portal'),
    path('stripe/webhook/', views.stripe_webhook, name='stripe_webhook'),
]
