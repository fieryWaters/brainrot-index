"""Creates in Stripe what the site needs, so nothing is set up by hand in the
Stripe dashboard. Safe to run again: whatever exists already is left alone.

Without options: the "Brainrot Index" product with its $5/month price (found
by its lookup key) and this site's Customer Portal configuration.

With --webhook-url: also the webhook endpoint. Stripe shows its signing secret
only once, when it is created, and it is the only thing written to standard
output, so it can be piped into .env without appearing on screen. Standard
output must therefore be a pipe; every message goes to standard error.
"""

import sys

import stripe
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from billing.stripe_sync import (
    PORTAL_CONFIGURATION_SITE,
    PRICE_CENTS,
    PRICE_LOOKUP_KEY,
    PRODUCT_NAME,
    monthly_price,
    portal_configuration_id,
    stripe_client,
)
from billing.views import INVOICE_EVENTS, SUBSCRIPTION_EVENTS

WEBHOOK_EVENTS = sorted({'checkout.session.completed'} | SUBSCRIPTION_EVENTS | INVOICE_EVENTS)


class Command(BaseCommand):
    help = 'Creates the Stripe product, price, Customer Portal configuration and, optionally, webhook endpoint.'

    def add_arguments(self, parser):
        parser.add_argument('--webhook-url', help='Public address of /api/stripe/webhook/')

    def say(self, message):
        self.stderr.write(message)

    def handle(self, *args, **options):
        if not settings.STRIPE_SECRET_KEY:
            raise CommandError('STRIPE_TEST_SECRET_KEY is not set')
        if not settings.STRIPE_SECRET_KEY.startswith('sk_test_'):
            raise CommandError('Only a Stripe test-mode key is expected here')
        webhook_url = options['webhook_url']
        if webhook_url and sys.stdout.isatty():
            raise CommandError('With --webhook-url, pipe standard output into .env (see DEPLOY.md)')

        client = stripe_client()
        self.create_price(client)
        self.create_portal_configuration(client)
        if webhook_url:
            self.create_webhook_endpoint(client, webhook_url)

    def create_price(self, client):
        price = monthly_price()
        if price is not None:
            self.say(f'Price {PRICE_LOOKUP_KEY} exists: {price["id"]}')
            return
        price = client.v1.prices.create({
            'currency': 'usd',
            'unit_amount': PRICE_CENTS,
            'recurring': {'interval': 'month'},
            'lookup_key': PRICE_LOOKUP_KEY,
            'product_data': {'name': PRODUCT_NAME},
        })
        self.say(f'Created product {price["product"]} and price {PRICE_LOOKUP_KEY}: {price["id"]}')

    def create_portal_configuration(self, client):
        configuration_id = portal_configuration_id()
        if configuration_id is not None:
            self.say(f'Customer Portal configuration exists: {configuration_id}')
            return
        configuration = client.v1.billing_portal.configurations.create({
            'name': PRODUCT_NAME,
            'metadata': {'site': PORTAL_CONFIGURATION_SITE},
            'features': {
                'subscription_cancel': {'enabled': True, 'mode': 'at_period_end'},
                'payment_method_update': {'enabled': True},
                'invoice_history': {'enabled': True},
            },
        })
        self.say(f'Created Customer Portal configuration: {configuration["id"]}')

    def create_webhook_endpoint(self, client, webhook_url):
        endpoints = client.v1.webhook_endpoints.list({'limit': 100})
        for endpoint in endpoints['data']:
            if endpoint['url'] == webhook_url:
                raise CommandError(
                    f'A webhook endpoint for {webhook_url} exists already ({endpoint["id"]}), and Stripe '
                    'shows a signing secret only when an endpoint is created. Roll its secret in the '
                    'Stripe dashboard, or delete it there and run this again.'
                )
        endpoint = client.v1.webhook_endpoints.create({
            'url': webhook_url,
            'enabled_events': WEBHOOK_EVENTS,
            'api_version': stripe.api_version,
            'description': PRODUCT_NAME,
        })
        self.say(f'Created webhook endpoint {endpoint["id"]} for {webhook_url}')
        sys.stdout.write(endpoint['secret'])
        sys.stdout.flush()
