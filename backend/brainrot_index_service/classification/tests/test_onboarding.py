from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from api.models import UserProfile

from .helpers import bearer, create_user_with_token, seen_post

User = get_user_model()


@patch('classification.views.PENDING_WAIT_SECONDS', 0)
class OnboardingStatusTests(TestCase):
    def status(self, user):
        self.client.force_login(user)
        response = self.client.get(reverse('onboarding_status'))
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_new_unverified_account_has_done_nothing(self):
        user = User.objects.create_user(username='new@example.com', email='new@example.com')
        UserProfile.objects.create(user=user, email_verified=False)
        self.assertEqual(self.status(user), {
            'email_verified': False,
            'extension_connected': False,
            'feed_opened': False,
        })

    def test_connected_extension_counts_once_it_sends_posts(self):
        user, raw_token = create_user_with_token('reader@example.com')
        self.client.get(reverse('extension_config'), **bearer(raw_token))
        self.assertEqual(self.status(user), {
            'email_verified': True,
            'extension_connected': True,
            'feed_opened': False,
        })

        self.client.post(reverse('classify'), {'posts': [seen_post('t3_first')]},
                         content_type='application/json', **bearer(raw_token))
        self.assertTrue(self.status(user)['feed_opened'])

    def test_needs_a_session(self):
        self.assertEqual(self.client.get(reverse('onboarding_status')).status_code, 403)
