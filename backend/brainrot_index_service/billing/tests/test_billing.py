import hashlib
import hmac
import json
import time
from contextlib import contextmanager
from datetime import timedelta
from io import StringIO
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from billing.access import account_has_access
from billing.models import STATUS_ACTIVE, STATUS_CANCELED, STATUS_TRIALING, StripeEvent, Subscription
from classification.tests.helpers import bearer, create_user_with_token

WEBHOOK_SECRET = 'whsec_test_secret'
CUSTOMER_ID = 'cus_reader'
SUBSCRIPTION_ID = 'sub_reader'


def unix(moment):
    return int(moment.timestamp())


def stripe_subscription(status='active', period_end=None, cancel_at_period_end=False, customer=CUSTOMER_ID):
    if period_end is None:
        period_end = timezone.now() + timedelta(days=30)
    return {
        'id': SUBSCRIPTION_ID,
        'customer': customer,
        'status': status,
        'cancel_at_period_end': cancel_at_period_end,
        'cancel_at': None,
        'items': {'data': [{'current_period_end': unix(period_end)}]},
    }


@contextmanager
def fake_stripe(client):
    with patch('billing.stripe_sync.stripe_client', return_value=client), \
            patch('billing.views.stripe_client', return_value=client), \
            patch('billing.management.commands.setup_stripe.stripe_client', return_value=client):
        yield client


def signed_webhook_headers(payload, secret=WEBHOOK_SECRET):
    timestamp = int(time.time())
    signature = hmac.new(secret.encode(), f'{timestamp}.{payload}'.encode(), hashlib.sha256).hexdigest()
    return {'HTTP_STRIPE_SIGNATURE': f't={timestamp},v1={signature}'}


def end_trial(user):
    Subscription.objects.filter(user=user).update(trial_end=timezone.now() - timedelta(minutes=1))


@override_settings(STRIPE_SECRET_KEY='sk_test_fake', STRIPE_WEBHOOK_SECRET=WEBHOOK_SECRET)
class BillingTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')

    def subscription(self):
        return Subscription.objects.get(user=self.user)

    def link_stripe_customer(self):
        Subscription.objects.filter(user=self.user).update(stripe_customer_id=CUSTOMER_ID)

    def post_webhook(self, event, secret=WEBHOOK_SECRET):
        payload = json.dumps(event)
        return self.client.post(
            reverse('stripe_webhook'),
            payload,
            content_type='application/json',
            **signed_webhook_headers(payload, secret),
        )

    def test_new_account_starts_seven_day_trial(self):
        subscription = self.subscription()
        self.assertEqual(subscription.status, STATUS_TRIALING)
        self.assertAlmostEqual(
            subscription.trial_end - timezone.now(), timedelta(days=7), delta=timedelta(minutes=1))
        self.assertEqual(self.client.get(reverse('extension_config'), **bearer(self.token)).status_code, 200)

        self.client.force_login(self.user)
        billing = self.client.get(reverse('billing_status')).json()
        self.assertEqual(billing['trial_days_left'], 7)
        self.assertTrue(billing['has_access'])

    def test_trial_expiry_gives_402(self):
        end_trial(self.user)

        config = self.client.get(reverse('extension_config'), **bearer(self.token))
        classify = self.client.post(reverse('classify'), {'posts': []}, content_type='application/json', **bearer(self.token))

        self.assertEqual(config.status_code, 402)
        self.assertEqual(classify.status_code, 402)

    def test_checkout_carries_remaining_trial_and_creates_customer(self):
        client = MagicMock()
        client.v1.prices.list.return_value = {'data': [{'id': 'price_monthly'}]}
        client.v1.customers.create.return_value = {'id': CUSTOMER_ID}
        client.v1.checkout.sessions.create.return_value = {'url': 'https://checkout.stripe.com/c/pay/cs_test'}
        self.client.force_login(self.user)

        with fake_stripe(client):
            response = self.client.post(reverse('billing_checkout'))

        self.assertEqual(response.json(), {'url': 'https://checkout.stripe.com/c/pay/cs_test'})
        self.assertEqual(self.subscription().stripe_customer_id, CUSTOMER_ID)
        session_params = client.v1.checkout.sessions.create.call_args.args[0]
        self.assertEqual(session_params['customer'], CUSTOMER_ID)
        self.assertEqual(session_params['subscription_data']['trial_end'], unix(self.subscription().trial_end))

    def test_checkout_reconcile_activates(self):
        self.link_stripe_customer()
        end_trial(self.user)
        client = MagicMock()
        client.v1.checkout.sessions.retrieve.return_value = {
            'customer': CUSTOMER_ID, 'status': 'complete', 'subscription': SUBSCRIPTION_ID,
        }
        client.v1.subscriptions.retrieve.return_value = stripe_subscription()
        self.client.force_login(self.user)

        with fake_stripe(client):
            response = self.client.post(
                reverse('billing_checkout_reconcile'), {'session_id': 'cs_test'}, content_type='application/json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], STATUS_ACTIVE)
        self.assertTrue(response.json()['has_access'])
        self.assertEqual(self.subscription().stripe_subscription_id, SUBSCRIPTION_ID)
        self.assertEqual(self.client.get(reverse('extension_config'), **bearer(self.token)).status_code, 200)

    def test_reconcile_refuses_another_customers_session(self):
        self.link_stripe_customer()
        client = MagicMock()
        client.v1.checkout.sessions.retrieve.return_value = {
            'customer': 'cus_someone_else', 'status': 'complete', 'subscription': 'sub_other',
        }
        self.client.force_login(self.user)

        with fake_stripe(client):
            response = self.client.post(
                reverse('billing_checkout_reconcile'), {'session_id': 'cs_other'}, content_type='application/json')

        self.assertEqual(response.status_code, 404)
        client.v1.subscriptions.retrieve.assert_not_called()

    def test_webhook_with_wrong_signature_is_rejected(self):
        self.link_stripe_customer()
        event = {'id': 'evt_1', 'type': 'customer.subscription.updated', 'data': {'object': stripe_subscription()}}

        response = self.post_webhook(event, secret='whsec_wrong')

        self.assertEqual(response.status_code, 400)
        self.assertFalse(StripeEvent.objects.exists())
        self.assertEqual(self.subscription().status, STATUS_TRIALING)

    def test_webhook_updates_subscription_and_ignores_duplicate_event(self):
        self.link_stripe_customer()
        client = MagicMock()
        client.v1.subscriptions.retrieve.return_value = stripe_subscription()
        event = {'id': 'evt_1', 'type': 'customer.subscription.updated', 'data': {'object': stripe_subscription()}}

        with fake_stripe(client):
            first = self.post_webhook(event)
            second = self.post_webhook(event)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(client.v1.subscriptions.retrieve.call_count, 1)
        self.assertEqual(StripeEvent.objects.count(), 1)
        self.assertEqual(self.subscription().status, STATUS_ACTIVE)

    def test_webhook_for_another_sites_customer_is_ignored(self):
        client = MagicMock()
        client.v1.subscriptions.retrieve.return_value = stripe_subscription(customer='cus_other_site')
        event = {'id': 'evt_2', 'type': 'customer.subscription.created', 'data': {'object': stripe_subscription()}}

        with fake_stripe(client):
            response = self.post_webhook(event)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.subscription().status, STATUS_TRIALING)

    def test_invoice_payment_failed_finds_subscription_through_parent(self):
        self.link_stripe_customer()
        client = MagicMock()
        client.v1.subscriptions.retrieve.return_value = stripe_subscription(status='past_due')
        invoice = {'parent': {'subscription_details': {'subscription': SUBSCRIPTION_ID}}}
        event = {'id': 'evt_3', 'type': 'invoice.payment_failed', 'data': {'object': invoice}}

        with fake_stripe(client):
            self.post_webhook(event)

        client.v1.subscriptions.retrieve.assert_called_once_with(SUBSCRIPTION_ID)
        self.assertEqual(self.subscription().status, 'past_due')
        self.assertTrue(account_has_access(self.user))

    def test_cancel_keeps_access_until_period_end(self):
        self.link_stripe_customer()
        end_trial(self.user)
        period_end = timezone.now() + timedelta(days=10)
        client = MagicMock()
        client.v1.subscriptions.retrieve.return_value = stripe_subscription(
            period_end=period_end, cancel_at_period_end=True)
        event = {'id': 'evt_4', 'type': 'customer.subscription.updated', 'data': {'object': {'id': SUBSCRIPTION_ID}}}

        with fake_stripe(client):
            self.post_webhook(event)
        self.assertTrue(self.subscription().cancel_at_period_end)
        self.assertTrue(account_has_access(self.user))

        # The period ends with no webhook delivered: access asks Stripe once and finds it canceled.
        client.v1.subscriptions.retrieve.return_value = stripe_subscription(
            status='canceled', period_end=period_end, cancel_at_period_end=True)
        with fake_stripe(client), patch('billing.access.timezone.now', return_value=period_end + timedelta(minutes=1)):
            self.assertFalse(account_has_access(self.user))
            self.assertFalse(account_has_access(self.user))
        self.assertEqual(self.subscription().status, STATUS_CANCELED)
        self.assertEqual(client.v1.subscriptions.retrieve.call_count, 2)

    def test_renewal_without_webhook_keeps_access(self):
        self.link_stripe_customer()
        Subscription.objects.filter(user=self.user).update(
            status=STATUS_ACTIVE,
            stripe_subscription_id=SUBSCRIPTION_ID,
            current_period_end=timezone.now() - timedelta(minutes=1),
        )
        client = MagicMock()
        client.v1.subscriptions.retrieve.return_value = stripe_subscription()

        with fake_stripe(client):
            self.assertTrue(account_has_access(self.user))
        self.assertGreater(self.subscription().current_period_end, timezone.now())

    def test_comp_account_is_never_blocked(self):
        end_trial(self.user)
        call_command('grant_comp', 'Reader@Example.com', stdout=StringIO())

        self.assertTrue(self.subscription().comp)
        self.assertEqual(self.client.get(reverse('extension_config'), **bearer(self.token)).status_code, 200)

        Subscription.objects.filter(user=self.user).update(status=STATUS_CANCELED, stripe_subscription_id=SUBSCRIPTION_ID)
        self.assertTrue(account_has_access(self.user))


@override_settings(STRIPE_SECRET_KEY='sk_test_fake')
class SetupStripeTests(TestCase):
    def test_creates_price_and_portal_only_when_missing(self):
        client = MagicMock()
        client.v1.prices.list.return_value = {'data': []}
        client.v1.prices.create.return_value = {'id': 'price_new', 'product': 'prod_new'}
        client.v1.billing_portal.configurations.list.return_value = {'data': []}
        client.v1.billing_portal.configurations.create.return_value = {'id': 'bpc_new'}

        with fake_stripe(client):
            call_command('setup_stripe', stderr=StringIO())
        self.assertEqual(client.v1.prices.create.call_args.args[0]['lookup_key'], 'brainrot_index_monthly')
        self.assertEqual(client.v1.prices.create.call_args.args[0]['unit_amount'], 500)
        client.v1.billing_portal.configurations.create.assert_called_once()

        client.reset_mock()
        client.v1.prices.list.return_value = {'data': [{'id': 'price_new'}]}
        client.v1.billing_portal.configurations.list.return_value = {
            'data': [{'id': 'bpc_new', 'metadata': {'site': 'brainrot_index'}}]}
        with fake_stripe(client):
            call_command('setup_stripe', stderr=StringIO())
        client.v1.prices.create.assert_not_called()
        client.v1.billing_portal.configurations.create.assert_not_called()

    def test_webhook_secret_goes_only_to_standard_output(self):
        client = MagicMock()
        client.v1.prices.list.return_value = {'data': [{'id': 'price_new'}]}
        client.v1.billing_portal.configurations.list.return_value = {
            'data': [{'id': 'bpc_new', 'metadata': {'site': 'brainrot_index'}}]}
        client.v1.webhook_endpoints.list.return_value = {'data': []}
        client.v1.webhook_endpoints.create.return_value = {'id': 'we_new', 'secret': 'whsec_created'}
        standard_output = StringIO()
        messages = StringIO()

        with fake_stripe(client), patch('sys.stdout', standard_output):
            call_command('setup_stripe', webhook_url='https://brainrotindex.com/api/stripe/webhook/', stderr=messages)

        self.assertEqual(standard_output.getvalue(), 'whsec_created')
        self.assertNotIn('whsec_created', messages.getvalue())
