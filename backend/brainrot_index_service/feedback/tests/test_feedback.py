from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import CommandError, call_command
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from classification.tests.helpers import bearer, create_user_with_token
from api.tests.test_invites import run_thread_now
from feedback.models import Feedback


@override_settings(GIT_COMMIT='abc1234')
class FeedbackEndpointTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')

    def test_extension_sends_feedback_with_bearer_token(self):
        response = self.client.post(
            reverse('create_feedback'),
            {
                'source': 'extension',
                'extension_commit': 'ext9999',
                'text': 'Too many ads in my feed.',
                'page_url': 'https://x.com/home',
            },
            content_type='application/json',
            **bearer(self.token),
        )

        self.assertEqual(response.status_code, 201)
        feedback = Feedback.objects.get(id=response.json()['id'])
        self.assertEqual(feedback.user, self.user)
        self.assertEqual(feedback.site_commit, 'abc1234')
        self.assertEqual(feedback.extension_commit, 'ext9999')
        self.assertEqual(feedback.page_url, 'https://x.com/home')

    def test_site_sends_feedback_with_session_and_csrf(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        client.get(reverse('auth_csrf'))
        csrf_token = client.cookies['csrftoken'].value

        response = client.post(
            reverse('create_feedback'),
            {'source': 'site', 'text': 'The slider label is confusing.', 'page_url': 'https://example.com/dashboard'},
            content_type='application/json',
            HTTP_X_CSRFTOKEN=csrf_token,
        )

        self.assertEqual(response.status_code, 201)
        feedback = Feedback.objects.get(id=response.json()['id'])
        self.assertEqual(feedback.source, 'site')
        self.assertEqual(feedback.page_url, 'https://example.com/dashboard')
        self.assertEqual(feedback.site_commit, 'abc1234')

    def test_session_without_csrf_is_rejected(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        response = client.post(
            reverse('create_feedback'),
            {'source': 'site', 'text': 'Forged'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Feedback.objects.count(), 0)

    def test_a_rating_alone_is_enough(self):
        response = self.client.post(
            reverse('create_feedback'), {'source': 'site', 'rating': 'down'}, content_type='application/json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Feedback.objects.get(id=response.json()['id']).rating, 'down')

    def test_rating_or_text_is_required(self):
        response = self.client.post(
            reverse('create_feedback'), {'source': 'extension'}, content_type='application/json', **bearer(self.token))
        self.assertEqual(response.status_code, 400)

    def test_source_is_required(self):
        response = self.client.post(
            reverse('create_feedback'), {'text': 'Hello'}, content_type='application/json', **bearer(self.token))
        self.assertEqual(response.status_code, 400)

    def test_feedback_from_someone_not_signed_in_is_stored_without_a_user(self):
        response = self.client.post(
            reverse('create_feedback'), {'source': 'site', 'text': 'Hello'}, content_type='application/json')
        self.assertEqual(response.status_code, 201)
        feedback = Feedback.objects.get(id=response.json()['id'])
        self.assertIsNone(feedback.user)
        self.assertEqual(feedback.site_commit, 'abc1234')

    def test_an_invalid_extension_token_is_still_401(self):
        response = self.client.post(
            reverse('create_feedback'), {'source': 'extension', 'text': 'Hello'},
            content_type='application/json', HTTP_AUTHORIZATION='Bearer not-a-token')
        self.assertEqual(response.status_code, 401)
        self.assertEqual(Feedback.objects.count(), 0)

    def test_health_reports_the_running_commit(self):
        response = self.client.get(reverse('health_check'), HTTP_X_FORWARDED_PROTO='https')
        self.assertEqual(response.json(), {'status': 'ok', 'commit': 'abc1234'})


@override_settings(GIT_COMMIT='abc1234', ADMIN_EMAIL='owner@example.com', FRONTEND_BASE_URL='https://brainrotindex.com')
class FeedbackAlertTests(TestCase):
    def send(self, body, **extra):
        with patch('api.emails.threading.Thread', side_effect=run_thread_now):
            return self.client.post(reverse('create_feedback'), body, content_type='application/json', **extra)

    def test_reports_are_not_emailed_since_the_owner_reads_them_in_the_inbox(self):
        user, token = create_user_with_token('reader@example.com')
        extension_response = self.send(
            {'source': 'extension', 'text': 'Missed this one'},
            **bearer(token))
        site_response = self.send({'source': 'site', 'rating': 'up'})

        self.assertEqual(extension_response.status_code, 201)
        self.assertEqual(site_response.status_code, 201)
        self.assertEqual(Feedback.objects.count(), 2)
        self.assertEqual(len(mail.outbox), 0)

    def test_someone_not_signed_in_can_leave_a_reply_address(self):
        response = self.send({'source': 'site', 'text': 'How do I cancel?', 'reply_email': 'visitor@example.com'})

        self.assertEqual(response.status_code, 201)
        feedback = Feedback.objects.get(id=response.json()['id'])
        self.assertIsNone(feedback.user)
        self.assertEqual(feedback.reply_email, 'visitor@example.com')

    def test_an_invalid_reply_address_is_refused(self):
        response = self.send({'source': 'site', 'text': 'Hi', 'reply_email': 'not an address'})
        self.assertEqual(response.status_code, 400)


class ResolvingFeedbackTests(TestCase):
    def setUp(self):
        self.user, _ = create_user_with_token('reader@example.com')
        self.open_report = Feedback.objects.create(user=self.user, source='site', text='Open one', site_commit='abc1234')
        self.fixed_report = Feedback.objects.create(user=self.user, source='site', text='Fixed one', site_commit='abc1234')

    def run_command(self, *arguments):
        output = StringIO()
        call_command(*arguments, stdout=output)
        return output.getvalue()

    def test_resolve_feedback_records_the_commit_and_note(self):
        self.run_command('resolve_feedback', str(self.fixed_report.id), '--commit', 'def5678', '--note', 'Label fixed')
        self.fixed_report.refresh_from_db()
        self.assertTrue(self.fixed_report.resolved)
        self.assertEqual(self.fixed_report.resolved_commit, 'def5678')
        self.assertEqual(self.fixed_report.resolved_note, 'Label fixed')

    def test_list_feedback_shows_only_open_reports_unless_all(self):
        self.run_command('resolve_feedback', str(self.fixed_report.id), '--commit', 'def5678', '--note', 'Label fixed')
        open_listing = self.run_command('list_feedback')
        self.assertIn('Open one', open_listing)
        self.assertNotIn('Fixed one', open_listing)
        full_listing = self.run_command('list_feedback', '--all')
        self.assertIn('Fixed one', full_listing)
        self.assertIn('resolved in def5678: Label fixed', full_listing)

    def test_resolve_feedback_rejects_an_unknown_id(self):
        with self.assertRaises(CommandError):
            self.run_command('resolve_feedback', '99999', '--commit', 'def5678', '--note', 'x')
