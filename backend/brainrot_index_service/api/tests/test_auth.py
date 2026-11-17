from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, TransactionTestCase, override_settings
from django.urls import reverse

from api.models import InviteCode, UserProfile

User = get_user_model()


@override_settings(GOOGLE_CLIENT_ID='google-client-id')
class GoogleAuthenticationTests(TransactionTestCase):
    @patch('api.views.auth_google.google_id_token.verify_oauth2_token')
    def test_existing_password_account_can_sign_in_with_google(self, verify_token):
        user = User.objects.create_user(
            username='google-existing',
            email='existing@example.com',
            password='application-password',
        )
        UserProfile.objects.create(
            user=user,
            email_verified=True,
            auth_provider='password',
        )
        verify_token.return_value = {
            'iss': 'https://accounts.google.com',
            'email_verified': True,
            'sub': 'google-subject-123',
            'email': 'existing@example.com',
            'given_name': 'Existing',
            'family_name': 'Artist',
        }

        response = self.client.post(
            reverse('authenticate_with_google'),
            {'id_token': 'valid-google-token'},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(int(self.client.session['_auth_user_id']), user.id)
        user.profile.refresh_from_db()
        self.assertEqual(user.profile.auth_provider, 'hybrid')


@override_settings(LOCAL_AUTH_BYPASS=False)
class EmailPasswordAuthSecurityTests(TestCase):
    """Black-box checks of the signup/verify/reset security design, driven
    entirely through the real URLs and DB. The only mock captures the raw
    token argument from the outbound-email functions - view behavior is
    never stubbed, so these can't be satisfied by patching internals."""

    PASSWORD = 'correct-horse-9-battery'

    def setUp(self):
        # Throttle counters live in the shared cache and would otherwise
        # accumulate across tests (auth_login is 10/hour per IP).
        cache.clear()
        self.invite_code = InviteCode.objects.create(note='tests', max_uses=100).code

    def _signup_and_capture_token(self, client, email, password=PASSWORD):
        with patch('api.auth_views.send_email_verification') as send_verification:
            response = client.post(
                reverse('auth_signup'),
                {'email': email, 'password': password, 'invite_code': self.invite_code})
        self.assertEqual(response.status_code, 202)
        raw_token = send_verification.call_args[0][1]
        return response, raw_token

    def _create_verified_account(self, email):
        client = Client()
        _, raw_token = self._signup_and_capture_token(client, email)
        verify = client.post(reverse('auth_verify_email'), {'token': raw_token})
        self.assertEqual(verify.status_code, 200)

    def test_signup_responses_do_not_reveal_whether_account_exists(self):
        self._create_verified_account('taken@example.com')

        with patch('api.auth_views.send_email_verification'):
            existing_wrong_password = Client().post(
                reverse('auth_signup'),
                {'email': 'taken@example.com', 'password': 'wrong-guess-4-horse',
                 'invite_code': self.invite_code})
            brand_new_email = Client().post(
                reverse('auth_signup'),
                {'email': 'fresh@example.com', 'password': 'wrong-guess-4-horse',
                 'invite_code': self.invite_code})

        self.assertEqual(existing_wrong_password.status_code, 202)
        self.assertEqual(brand_new_email.status_code, 202)
        self.assertEqual(existing_wrong_password.content, brand_new_email.content)

    def test_signup_password_is_inert_until_email_is_verified(self):
        signup_client = Client()
        _, raw_token = self._signup_and_capture_token(signup_client, 'parked@example.com')

        before_verify = Client().post(
            reverse('auth_login'),
            {'email': 'parked@example.com', 'password': self.PASSWORD})
        self.assertEqual(before_verify.status_code, 401)

        verify = Client().post(reverse('auth_verify_email'), {'token': raw_token})
        self.assertEqual(verify.status_code, 200)

        after_verify = Client().post(
            reverse('auth_login'),
            {'email': 'parked@example.com', 'password': self.PASSWORD})
        self.assertEqual(after_verify.status_code, 200)

    def test_the_browser_that_signed_up_stays_signed_in_after_verifying(self):
        signup_client = Client()
        _, raw_token = self._signup_and_capture_token(signup_client, 'newcomer@example.com')

        verify = signup_client.post(reverse('auth_verify_email'), {'token': raw_token})

        self.assertEqual(verify.status_code, 200)
        session = signup_client.get(reverse('current_session'))
        self.assertEqual(session.status_code, 200)
        self.assertTrue(session.json()['email_verified'])

    def test_password_reset_invalidates_other_sessions(self):
        self._create_verified_account('victim@example.com')
        credentials = {'email': 'victim@example.com', 'password': self.PASSWORD}
        client_a, client_b = Client(), Client()
        self.assertEqual(client_a.post(reverse('auth_login'), credentials).status_code, 200)
        self.assertEqual(client_b.post(reverse('auth_login'), credentials).status_code, 200)
        self.assertEqual(client_b.get(reverse('current_session')).status_code, 200)

        with patch('api.auth_views.send_password_reset') as send_reset:
            request_reset = client_a.post(
                reverse('auth_password_reset_request'), {'email': 'victim@example.com'})
        self.assertEqual(request_reset.status_code, 202)
        reset_token = send_reset.call_args[0][1]

        confirm = client_a.post(
            reverse('auth_password_reset_confirm'),
            {'token': reset_token, 'new_password': 'brand-new-7-stirrup'})
        self.assertEqual(confirm.status_code, 200)

        # The resetting client keeps its fresh session; the other session died.
        self.assertEqual(client_a.get(reverse('current_session')).status_code, 200)
        self.assertIn(client_b.get(reverse('current_session')).status_code, (401, 403))


