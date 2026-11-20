import json
from unittest.mock import MagicMock, patch

import stripe
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from billing.models import STATUS_ACTIVE, STATUS_TRIALING, Subscription
from classification.models import (
    Classification,
    ExtensionToken,
    Plugin,
    Post,
    PostJudgment,
    PostSubmission,
    UserPlugin,
    UserSettings,
)
from classification.tests.helpers import bearer, create_user_with_token, create_verified_user, seen_post
from families.models import ROLE_ADMIN, ROLE_CHILD, Family, FamilyMember
from feedback.models import Feedback
from store.models import PluginRating

User = get_user_model()

PASSWORD = 'unused-password-123'


def signed_in_client(user):
    client = Client()
    response = client.post(reverse('auth_login'), {'email': user.email, 'password': PASSWORD})
    assert response.status_code == 200
    return client


@override_settings(LOCAL_AUTH_BYPASS=False)
class ChangePasswordTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = create_verified_user('reader@example.com')

    def test_changes_the_password_and_ends_other_sessions_only(self):
        this_browser = signed_in_client(self.user)
        other_browser = signed_in_client(self.user)

        response = this_browser.post(
            reverse('account_change_password'),
            {'current_password': PASSWORD, 'new_password': 'a-brand-new-9-password'},
            content_type='application/json')

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password('a-brand-new-9-password'))
        self.assertEqual(this_browser.get(reverse('current_session')).status_code, 200)
        self.assertIn(other_browser.get(reverse('current_session')).status_code, (401, 403))

    def test_wrong_current_password_changes_nothing(self):
        client = signed_in_client(self.user)
        response = client.post(
            reverse('account_change_password'),
            {'current_password': 'not-my-password', 'new_password': 'a-brand-new-9-password'},
            content_type='application/json')

        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_weak_new_password_is_refused(self):
        client = signed_in_client(self.user)
        response = client.post(
            reverse('account_change_password'),
            {'current_password': PASSWORD, 'new_password': 'short'},
            content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_account_without_a_password_is_told_to_use_the_email_link(self):
        self.user.set_unusable_password()
        self.user.save()
        client = Client()
        client.force_login(self.user)
        response = client.post(
            reverse('account_change_password'),
            {'current_password': '', 'new_password': 'a-brand-new-9-password'},
            content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('email link', response.json()['error'])

    def test_needs_a_session(self):
        response = Client().post(reverse('account_change_password'), {}, content_type='application/json')
        self.assertEqual(response.status_code, 403)


@override_settings(LOCAL_AUTH_BYPASS=False)
class SignOutEverywhereTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_ends_every_session_and_disconnects_every_extension(self):
        user, raw_token = create_user_with_token('reader@example.com')
        this_browser = signed_in_client(user)
        other_browser = signed_in_client(user)

        response = this_browser.post(reverse('account_sign_out_everywhere'))

        self.assertEqual(response.status_code, 200)
        self.assertIn(this_browser.get(reverse('current_session')).status_code, (401, 403))
        self.assertIn(other_browser.get(reverse('current_session')).status_code, (401, 403))
        self.assertFalse(ExtensionToken.objects.filter(user=user).exists())
        self.assertEqual(Client().get(reverse('extension_config'), **bearer(raw_token)).status_code, 401)


@override_settings(LOCAL_AUTH_BYPASS=False)
class ExportTests(TestCase):
    def test_download_holds_the_persons_settings_plugins_and_feedback_only(self):
        user = create_verified_user('reader@example.com')
        someone_else = create_verified_user('other@example.com')
        Feedback.objects.create(user=user, source='site', text='The ragebait filter missed one.', site_commit='abc1234')
        Feedback.objects.create(user=someone_else, source='site', text='Not mine.', site_commit='abc1234')
        client = Client()
        client.force_login(user)
        client.get(reverse('user_settings'))

        response = client.get(reverse('account_export'))

        self.assertEqual(response.status_code, 200)
        self.assertIn('attachment', response['Content-Disposition'])
        data = json.loads(response.content)
        self.assertEqual(data['account']['email'], 'reader@example.com')
        self.assertEqual(data['settings'], {'enabled': True, 'mode': 'adult', 'allow_reveal': True})
        self.assertEqual(
            sorted(plugin['slug'] for plugin in data['plugins']),
            sorted(Plugin.objects.filter(is_baseline=True).values_list('slug', flat=True)))
        self.assertEqual([report['text'] for report in data['feedback']], ['The ragebait filter missed one.'])
        self.assertEqual(data['subscription']['status'], STATUS_TRIALING)

    @patch('classification.views.PENDING_WAIT_SECONDS', 0)
    def test_download_lists_the_posts_the_extension_sent(self):
        user, raw_token = create_user_with_token('reader@example.com')
        someone_else, other_token = create_user_with_token('other@example.com')
        for token, post_id in ((raw_token, 't3_mine'), (other_token, 't3_theirs')):
            Client().post(reverse('classify'), {'posts': [seen_post(post_id)]},
                          content_type='application/json', **bearer(token))
        client = Client()
        client.force_login(user)

        data = json.loads(client.get(reverse('account_export')).content)

        self.assertEqual(len(data['sent_posts']), 1)
        sent = data['sent_posts'][0]
        self.assertEqual(
            {key: sent[key] for key in ('platform', 'post_id', 'url')},
            {'platform': 'reddit', 'post_id': 't3_mine', 'url': 'https://www.reddit.com/r/gardening/comments/t3_mine/'})
        self.assertEqual(sent['first_seen_at'], sent['last_seen_at'])

    def test_needs_a_session(self):
        self.assertEqual(Client().get(reverse('account_export')).status_code, 403)


@override_settings(LOCAL_AUTH_BYPASS=False, STRIPE_SECRET_KEY='sk_test_fake')
@patch('classification.views.PENDING_WAIT_SECONDS', 0)
class DeleteAccountTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user, self.token = create_user_with_token('reader@example.com')
        self.client.force_login(self.user)

    def test_wrong_email_deletes_nothing(self):
        response = self.client.post(reverse('account_delete'), {'email': 'someone@example.com'},
                                    content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertTrue(User.objects.filter(id=self.user.id).exists())

    def test_removes_the_account_and_its_rows_and_keeps_the_shared_cache(self):
        self.client.get(reverse('user_settings'))
        self.client.post(reverse('classify'), {'posts': [seen_post('t3_shared')]},
                         content_type='application/json', **bearer(self.token))
        Feedback.objects.create(user=self.user, source='site', text='Hello.', site_commit='abc1234')
        user_id = self.user.id
        self.assertTrue(PostSubmission.objects.filter(user_id=user_id).exists())

        response = self.client.post(reverse('account_delete'), {'email': 'Reader@Example.com'},
                                    content_type='application/json')

        self.assertEqual(response.status_code, 200)
        self.assertFalse(User.objects.filter(id=user_id).exists())
        for model in (Subscription, UserSettings, UserPlugin, ExtensionToken, Feedback, PostSubmission):
            self.assertFalse(model.objects.filter(user_id=user_id).exists(), model.__name__)
        self.assertTrue(Post.objects.filter(post_id='t3_shared').exists())
        self.assertTrue(Classification.objects.filter(post__post_id='t3_shared').exists())
        self.assertEqual(Client().get(reverse('extension_config'), **bearer(self.token)).status_code, 401)
        self.assertIn(self.client.get(reverse('current_session')).status_code, (401, 403))

    def test_feedback_and_thumbs_on_posts_stay_without_who_sent_them(self):
        feedback = Feedback.objects.create(
            user=self.user, source='contact', name='Reader', reply_email='reader@home.example', subject='Hi',
            text='The slider is confusing.', site_commit='abc1234')
        post = Post.objects.create(platform='x', post_id='185', kind='post', url='https://x.com/a/status/185', text='LOUD')
        filter_results = [{'plugin': 'shouting', 'version': 1, 'score': 60, 'threshold': 50, 'flagged': True}]
        judgment = PostJudgment.objects.create(
            user=self.user, post=post, verdict='wrong', shown_action='hide', details='Fine, just loud.',
            filter_results=filter_results)

        response = self.client.post(reverse('account_delete'), {'email': 'reader@example.com'},
                                    content_type='application/json')

        self.assertEqual(response.status_code, 200)
        feedback.refresh_from_db()
        self.assertIsNone(feedback.user)
        self.assertEqual(feedback.name, '')
        self.assertEqual(feedback.reply_email, '')
        self.assertEqual(feedback.text, 'The slider is confusing.')
        judgment.refresh_from_db()
        self.assertIsNone(judgment.user)
        self.assertEqual(judgment.verdict, 'wrong')
        self.assertEqual(judgment.details, 'Fine, just loud.')
        self.assertEqual(judgment.post, post)
        self.assertEqual(judgment.filter_results, filter_results)

    def test_a_published_plugin_stays_without_its_author(self):
        plugin = Plugin.objects.create(slug='my-filter', name='My filter', description='Mine.', author=self.user)

        response = self.client.post(reverse('account_delete'), {'email': 'reader@example.com'},
                                    content_type='application/json')

        self.assertEqual(response.status_code, 200)
        plugin.refresh_from_db()
        self.assertIsNone(plugin.author)

    def test_the_last_admin_of_a_family_with_others_must_hand_over_first(self):
        family = Family.objects.create(name='The Readers', created_by=self.user)
        FamilyMember.objects.create(user=self.user, family=family, role=ROLE_ADMIN)
        child = create_verified_user('kid@example.com')
        FamilyMember.objects.create(user=child, family=family, role=ROLE_CHILD)

        response = self.client.post(reverse('account_delete'), {'email': 'reader@example.com'},
                                    content_type='application/json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('admin', response.json()['error'])
        self.assertTrue(User.objects.filter(id=self.user.id).exists())

    def test_ratings_and_family_place_go_with_the_account(self):
        family = Family.objects.create(name='Just me', created_by=self.user)
        FamilyMember.objects.create(user=self.user, family=family, role=ROLE_ADMIN)
        plugin = Plugin.objects.filter(is_baseline=True).first()
        PluginRating.objects.create(user=self.user, plugin=plugin, stars=4, review='Useful.')

        response = self.client.post(reverse('account_delete'), {'email': 'reader@example.com'},
                                    content_type='application/json')

        self.assertEqual(response.status_code, 200)
        self.assertFalse(PluginRating.objects.filter(review='Useful.').exists())
        self.assertFalse(FamilyMember.objects.filter(family=family).exists())

    def paying(self):
        Subscription.objects.filter(user=self.user).update(
            status=STATUS_ACTIVE, stripe_customer_id='cus_reader', stripe_subscription_id='sub_reader')

    def test_a_paid_subscription_is_canceled_at_stripe_first(self):
        self.paying()
        client = MagicMock()
        with patch('api.account_views.stripe_client', return_value=client):
            response = self.client.post(reverse('account_delete'), {'email': 'reader@example.com'},
                                        content_type='application/json')

        self.assertEqual(response.status_code, 200)
        client.v1.subscriptions.cancel.assert_called_once_with('sub_reader')
        self.assertFalse(User.objects.filter(email='reader@example.com').exists())

    def test_nothing_is_deleted_when_stripe_cannot_cancel(self):
        self.paying()
        client = MagicMock()
        client.v1.subscriptions.cancel.side_effect = stripe.APIConnectionError('down')
        with patch('api.account_views.stripe_client', return_value=client):
            response = self.client.post(reverse('account_delete'), {'email': 'reader@example.com'},
                                        content_type='application/json')

        self.assertEqual(response.status_code, 502)
        self.assertIn('Feedback button', response.json()['error'])
        self.assertTrue(User.objects.filter(email='reader@example.com').exists())
