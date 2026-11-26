"""Creates in Stripe what the site needs, so nothing is set up by hand in the
Stripe dashboard. Safe to run again: whatever exists already is left alone.

Without options: the "Brainrot Index" product with its $4.99/month price
(found by its lookup key) and this site's Customer Portal configuration.

Stripe prices cannot be changed. When PRICE_CENTS differs from the amount of
the price holding the lookup key, a new price is made on the same product and
the lookup key moves to it. Every run then makes the price holding the lookup
key the product's default price, deactivates the product's other prices, and
moves every subscription on another price of the product to it, with no
proration: nothing is charged or credited now, and the next renewal is at the
new amount.

With --webhook-url: also the webhook endpoint. Stripe shows its signing secret
only once, when it is created, and it is the only thing written to standard
output, so it can be piped into .env without appearing on screen. Standard
output must therefore be a pipe; every message goes to standard error.

With a live key (STRIPE_SECRET_KEY starting sk_live_ or rk_live_) the command
runs only with --live, so live objects are never created by accident.
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
    STATEMENT_DESCRIPTOR,
    monthly_price,
    portal_configuration_id,
    stripe_client,
)
from billing.views import INVOICE_EVENTS, SUBSCRIPTION_EVENTS

WEBHOOK_EVENTS = sorted({'checkout.session.completed'} | SUBSCRIPTION_EVENTS | INVOICE_EVENTS)


def subscriptions_on_price(client, price_id):
    """Every subscription on the price that is not canceled, read page by page."""
    subscriptions = []
    params = {'price': price_id, 'limit': 100}
    while True:
        page = client.v1.subscriptions.list(params)
        subscriptions.extend(page['data'])
        if not page['has_more']:
            return subscriptions
        params = {**params, 'starting_after': page['data'][-1]['id']}


class Command(BaseCommand):
    help = 'Creates the Stripe product, price, Customer Portal configuration and, optionally, webhook endpoint.'

    def add_arguments(self, parser):
        parser.add_argument('--webhook-url', help='Public address of /api/stripe/webhook/')
        parser.add_argument('--live', action='store_true', help='Required when the Stripe key is a live key')

    def say(self, message):
        self.stderr.write(message)

    def handle(self, *args, **options):
        if not settings.STRIPE_SECRET_KEY:
            raise CommandError('Neither STRIPE_SECRET_KEY nor STRIPE_TEST_SECRET_KEY is set')
        if settings.STRIPE_LIVE_MODE and not options['live']:
            raise CommandError('The Stripe key is a live key; pass --live to create live objects')
        if options['live'] and not settings.STRIPE_LIVE_MODE:
            raise CommandError('--live was given but the Stripe key is a test key')
        if settings.STRIPE_LIVE_MODE:
            self.say('Stripe live mode')
        else:
            self.say('Stripe test mode')
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
        if price is None:
            self.create_first_price(client)
            return
        if price['unit_amount'] == PRICE_CENTS:
            self.say(f'Price {PRICE_LOOKUP_KEY} exists: {price["id"]}')
        else:
            price = self.replace_price(client, price)
        other_prices = []
        for product_price in client.v1.prices.list({'product': price['product'], 'limit': 100})['data']:
            if product_price['id'] != price['id']:
                other_prices.append(product_price)
        self.deactivate_other_prices(client, price, other_prices)
        self.move_subscriptions_to(client, price, other_prices)

    def create_first_price(self, client):
        price = client.v1.prices.create({
            'currency': 'usd',
            'unit_amount': PRICE_CENTS,
            'recurring': {'interval': 'month'},
            'lookup_key': PRICE_LOOKUP_KEY,
            'product_data': {'name': PRODUCT_NAME, 'statement_descriptor': STATEMENT_DESCRIPTOR},
        })
        self.say(f'Created product {price["product"]} and price {PRICE_LOOKUP_KEY}: {price["id"]}')

    def replace_price(self, client, old_price):
        price = client.v1.prices.create({
            'currency': 'usd',
            'unit_amount': PRICE_CENTS,
            'recurring': {'interval': 'month'},
            'product': old_price['product'],
            'lookup_key': PRICE_LOOKUP_KEY,
            'transfer_lookup_key': True,
        })
        self.say(f'Created price {price["id"]} at {PRICE_CENTS} cents and moved {PRICE_LOOKUP_KEY} to it '
                 f'from {old_price["id"]} ({old_price["unit_amount"]} cents)')
        return price

    # Stripe refuses to deactivate the product's default price, so the default moves first.
    def deactivate_other_prices(self, client, price, other_prices):
        active_other_prices = [other_price for other_price in other_prices if other_price['active']]
        if not active_other_prices:
            return
        client.v1.products.update(price['product'], {'default_price': price['id']})
        for other_price in active_other_prices:
            client.v1.prices.update(other_price['id'], {'active': False})
            self.say(f'Deactivated price {other_price["id"]} ({other_price["unit_amount"]} cents)')

    def move_subscriptions_to(self, client, price, other_prices):
        moved_count = 0
        for other_price in other_prices:
            for subscription in subscriptions_on_price(client, other_price['id']):
                item = subscription['items']['data'][0]
                client.v1.subscriptions.update(subscription['id'], {
                    'items': [{'id': item['id'], 'price': price['id']}],
                    'proration_behavior': 'none',
                })
                moved_count = moved_count + 1
        self.say(f'Moved {moved_count} subscriptions to price {price["id"]}')

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
