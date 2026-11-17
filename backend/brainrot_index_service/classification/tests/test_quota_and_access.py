from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from api.auth_tokens import generate_raw_token, hash_token
from api.models import DailyNewPostCount, UserProfile
from classification.models import CLASSIFICATION_DONE, Classification, ExtensionToken, Post
from classification.views import ClassifyThrottle

from .helpers import bearer, create_user_with_token, seen_post

User = get_user_model()


@patch('classification.views.PENDING_WAIT_SECONDS', 0)
@override_settings(DAILY_NEW_POST_QUOTA=2)
class DailyQuotaTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user, self.token = create_user_with_token('reader@example.com')

    def classify(self, posts, token=None):
        return self.client.post(
            reverse('classify'), {'posts': posts}, content_type='application/json', **bearer(token or self.token))

    def results_by_post_id(self, response):
        return {result['post_id']: result for result in response.json()['results']}

    def test_posts_past_the_quota_are_allowed_unclassified_with_a_notice(self):
        response = self.classify([seen_post('p1'), seen_post('p2'), seen_post('p3')])

        results = self.results_by_post_id(response)
        self.assertEqual(results['p1']['status'], 'pending')
        self.assertEqual(results['p2']['status'], 'pending')
        self.assertEqual(results['p3'], {
            'platform': 'reddit', 'post_id': 'p3', 'status': 'done', 'action': 'allow', 'reasons': [],
            'notice': 'daily_limit_reached',
        })
        self.assertFalse(Post.objects.filter(post_id='p3').exists())
        self.assertEqual(DailyNewPostCount.objects.get(user=self.user).count, 2)

    def test_cached_posts_are_still_answered_and_cost_nothing_after_the_quota(self):
        self.classify([seen_post('p1'), seen_post('p2')])
        Classification.objects.filter(post__post_id='p1').update(status=CLASSIFICATION_DONE, score=95, label='bait')

        response = self.classify([seen_post('p1'), seen_post('p2'), seen_post('p3')])

        results = self.results_by_post_id(response)
        self.assertEqual(results['p1']['status'], 'done')
        self.assertNotEqual(results['p1']['action'], 'allow')
        self.assertEqual(results['p2']['status'], 'pending')
        self.assertEqual(results['p3']['notice'], 'daily_limit_reached')
        self.assertEqual(DailyNewPostCount.objects.get(user=self.user).count, 2)

    def test_a_post_another_account_already_sent_is_free(self):
        _, other_token = create_user_with_token('other@example.com')
        self.classify([seen_post('shared')], token=other_token)

        self.classify([seen_post('shared'), seen_post('p1'), seen_post('p2')])

        self.assertEqual(DailyNewPostCount.objects.get(user=self.user).count, 2)
        self.assertTrue(Post.objects.filter(post_id='p2').exists())

    def test_the_quota_starts_again_each_day(self):
        yesterday = timezone.now().date() - timedelta(days=1)
        DailyNewPostCount.objects.create(user=self.user, day=yesterday, count=2)

        response = self.classify([seen_post('p1')])

        self.assertEqual(response.json()['results'][0]['status'], 'pending')


class ClassifyRateLimitTests(TestCase):
    def setUp(self):
        cache.clear()

    @patch('classification.views.PENDING_WAIT_SECONDS', 0)
    @patch.object(ClassifyThrottle, 'rate', '2/minute', create=True)
    def test_classify_is_limited_per_account(self):
        _, token = create_user_with_token('reader@example.com')
        _, other_token = create_user_with_token('other@example.com')

        def classify(raw_token):
            return self.client.post(
                reverse('classify'), {'posts': []}, content_type='application/json', **bearer(raw_token))

        self.assertEqual(classify(token).status_code, 200)
        self.assertEqual(classify(token).status_code, 200)
        self.assertEqual(classify(token).status_code, 429)
        self.assertEqual(classify(other_token).status_code, 200)


class UnverifiedEmailTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username='new@example.com', email='new@example.com')
        UserProfile.objects.create(user=self.user, email_verified=False)
        self.raw_token = generate_raw_token()
        ExtensionToken.objects.create(user=self.user, token_hash=hash_token(self.raw_token))

    def assert_verify_first(self, response):
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json(), {'detail': 'Verify your email first.', 'code': 'email_not_verified'})

    def test_unverified_account_gets_no_extension_token(self):
        self.client.force_login(self.user)
        self.assert_verify_first(self.client.post(reverse('create_extension_token')))
        self.assertEqual(ExtensionToken.objects.filter(user=self.user).count(), 1)

    def test_token_of_unverified_account_cannot_classify_or_read_config(self):
        self.assert_verify_first(self.client.get(reverse('extension_config'), **bearer(self.raw_token)))
        self.assert_verify_first(self.client.post(
            reverse('classify'), {'posts': [seen_post('p1')]},
            content_type='application/json', **bearer(self.raw_token)))
        self.assertFalse(Post.objects.exists())

    def test_account_without_a_profile_counts_as_unverified(self):
        UserProfile.objects.filter(user=self.user).delete()
        self.assert_verify_first(self.client.get(reverse('extension_config'), **bearer(self.raw_token)))
