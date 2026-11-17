from django.contrib import admin

from .models import StripeEvent, Subscription


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ['user', 'status', 'comp', 'trial_end', 'current_period_end', 'cancel_at_period_end']
    list_filter = ['status', 'comp', 'cancel_at_period_end']
    search_fields = ['user__email', 'stripe_customer_id', 'stripe_subscription_id']


@admin.register(StripeEvent)
class StripeEventAdmin(admin.ModelAdmin):
    list_display = ['event_id', 'event_type', 'received_at']
    list_filter = ['event_type']
    search_fields = ['event_id']
