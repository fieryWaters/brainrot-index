from django.test import Client, TestCase, override_settings
from django.urls import reverse

from classification.tests.helpers import bearer, create_user_with_token
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
                'platform': 'x',
                'post_id': '1850000000000000000',
                'shown_action': 'allow',
                'expected_action': 'hide',
            },
            content_type='application/json',
            **bearer(self.token),
        )

        self.assertEqual(response.status_code, 201)
        feedback = Feedback.objects.get(id=response.json()['id'])
        self.assertEqual(feedback.user, self.user)
        self.assertEqual(feedback.site_commit, 'abc1234')
        self.assertEqual(feedback.extension_commit, 'ext9999')
        self.assertEqual(feedback.expected_action, 'hide')

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

    def test_missed_post_report_needs_only_page_and_expected_action(self):
        response = self.client.post(
            reverse('create_feedback'),
            {'source': 'extension', 'page_url': 'https://x.com/home', 'expected_action': 'hide'},
            content_type='application/json',
            **bearer(self.token),
        )
        self.assertEqual(response.status_code, 201)

    def test_text_or_expected_action_is_required(self):
        response = self.client.post(
            reverse('create_feedback'), {'source': 'extension'}, content_type='application/json', **bearer(self.token))
        self.assertEqual(response.status_code, 400)

    def test_source_is_required(self):
        response = self.client.post(
            reverse('create_feedback'), {'text': 'Hello'}, content_type='application/json', **bearer(self.token))
        self.assertEqual(response.status_code, 400)

    def test_anonymous_feedback_is_401(self):
        response = self.client.post(
            reverse('create_feedback'), {'source': 'site', 'text': 'Hello'}, content_type='application/json')
        self.assertEqual(response.status_code, 401)

    def test_health_reports_the_running_commit(self):
        response = self.client.get(reverse('health_check'), HTTP_X_FORWARDED_PROTO='https')
        self.assertEqual(response.json(), {'status': 'ok', 'commit': 'abc1234'})
