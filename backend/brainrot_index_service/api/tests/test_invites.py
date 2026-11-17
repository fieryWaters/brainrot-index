from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from api.models import InviteCode, UserProfile

User = get_user_model()

PASSWORD = 'correct-horse-9-battery'


def run_thread_now(target, daemon):
    """A stand-in for threading.Thread that runs the target when started."""
    class ImmediateThread:
        def start(self):
            target()
    return ImmediateThread()


@override_settings(LOCAL_AUTH_BYPASS=False, SIGNUP_REQUIRES_INVITE=True)
class EmailSignupInviteTests(TestCase):
    def setUp(self):
        cache.clear()

    def signup(self, email, invite_code=None):
        body = {'email': email, 'password': PASSWORD}
        if invite_code is not None:
            body['invite_code'] = invite_code
        with patch('api.auth_views.send_email_verification'):
            return Client().post(reverse('auth_signup'), body)

    def test_signup_without_a_code_is_refused_and_creates_no_account(self):
        response = self.signup('new@example.com')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'invite_required')
        self.assertFalse(User.objects.filter(email='new@example.com').exists())

    def test_signup_with_an_unknown_code_is_refused(self):
        response = self.signup('new@example.com', 'NOPE-NOPE-NOPE')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['code'], 'invite_invalid')
        self.assertFalse(User.objects.filter(email='new@example.com').exists())

    def test_a_code_works_up_to_its_max_uses_typed_in_any_case(self):
        invite = InviteCode.objects.create(note='friend', max_uses=1)

        first = self.signup('first@example.com', '  ' + invite.code.lower() + ' ')
        self.assertEqual(first.status_code, 202)
        self.assertTrue(User.objects.filter(email='first@example.com').exists())
        invite.refresh_from_db()
        self.assertEqual(invite.uses, 1)

        second = self.signup('second@example.com', invite.code)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.json()['code'], 'invite_invalid')
        self.assertFalse(User.objects.filter(email='second@example.com').exists())

    def test_an_inactive_code_is_refused(self):
        invite = InviteCode.objects.create(note='withdrawn', max_uses=5, active=False)
        response = self.signup('new@example.com', invite.code)
        self.assertEqual(response.status_code, 400)

    def test_an_existing_account_still_signs_in_without_a_code(self):
        user = User.objects.create_user(username='old@example.com', email='old@example.com', password=PASSWORD)
        UserProfile.objects.create(user=user, email_verified=True)
        response = Client().post(reverse('auth_login'), {'email': 'old@example.com', 'password': PASSWORD})
        self.assertEqual(response.status_code, 200)

    @override_settings(SIGNUP_REQUIRES_INVITE=False)
    def test_no_code_is_needed_when_the_gate_is_off(self):
        response = self.signup('open@example.com')
        self.assertEqual(response.status_code, 202)
        self.assertTrue(User.objects.filter(email='open@example.com').exists())

    def test_a_failed_email_is_logged_as_an_error_and_signup_still_succeeds(self):
        invite = InviteCode.objects.create(note='friend')
        with patch('api.emails.threading.Thread', side_effect=run_thread_now), \
                patch('api.emails.send_mail', side_effect=RuntimeError('domain not verified')), \
                self.assertLogs('api.emails', level='ERROR') as logs:
            response = Client().post(
                reverse('auth_signup'),
                {'email': 'new@example.com', 'password': PASSWORD, 'invite_code': invite.code})
        self.assertEqual(response.status_code, 202)
        self.assertIn('RuntimeError: domain not verified', logs.output[0])


GOOGLE_PAYLOAD = {
    'iss': 'https://accounts.google.com',
    'email_verified': True,
    'sub': 'google-subject-456',
    'email': 'googler@example.com',
    'given_name': 'Goo',
    'family_name': 'Gler',
}


@override_settings(GOOGLE_CLIENT_ID='google-client-id', SIGNUP_REQUIRES_INVITE=True)
@patch('api.views.auth_google.google_id_token.verify_oauth2_token', return_value=GOOGLE_PAYLOAD)
class GoogleSignupInviteTests(TestCase):
    def setUp(self):
        cache.clear()

    def google_sign_in(self, invite_code=None):
        body = {'id_token': 'valid-google-token'}
        if invite_code is not None:
            body['invite_code'] = invite_code
        return self.client.post(reverse('authenticate_with_google'), body)

    def test_new_google_account_without_a_code_is_refused(self, verify_token):
        response = self.google_sign_in()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'invite_required')
        self.assertFalse(User.objects.filter(email='googler@example.com').exists())

    def test_new_google_account_with_a_code_is_created_verified(self, verify_token):
        invite = InviteCode.objects.create(note='friend')
        response = self.google_sign_in(invite.code)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['email_verified'])
        invite.refresh_from_db()
        self.assertEqual(invite.uses, 1)

    def test_existing_account_signs_in_with_google_without_a_code(self, verify_token):
        User.objects.create_user(username='googler', email='googler@example.com')
        response = self.google_sign_in()
        self.assertEqual(response.status_code, 200)


class InviteCommandTests(TestCase):
    def test_create_invite_prints_a_new_code(self):
        output = StringIO()
        call_command('create_invite', '--note', 'for Sam', '--max-uses', '5', stdout=output)
        invite = InviteCode.objects.get(code=output.getvalue().strip())
        self.assertEqual(invite.note, 'for Sam')
        self.assertEqual(invite.max_uses, 5)
        self.assertEqual(invite.uses, 0)

    def test_mark_email_verified(self):
        user = User.objects.create_user(username='old@example.com', email='old@example.com')
        call_command('mark_email_verified', 'OLD@example.com', stdout=StringIO())
        self.assertTrue(UserProfile.objects.get(user=user).email_verified)
