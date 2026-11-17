from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from api.models import UserProfile

User = get_user_model()

PASSWORD = 'correct-horse-9-battery'
ADMIN_EMAIL = 'owner@example.com'


@override_settings(LOCAL_AUTH_BYPASS=False, SIGNUP_REQUIRES_INVITE=False)
class OpenSignupTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_the_site_learns_that_no_invite_is_needed(self):
        self.assertEqual(self.client.get(reverse('auth_csrf')).json()['signup_requires_invite'], False)

    def test_signup_without_a_code_creates_an_unverified_account(self):
        with patch('api.auth_views.send_email_verification'):
            response = self.client.post(reverse('auth_signup'), {'email': 'new@example.com', 'password': PASSWORD})
        self.assertEqual(response.status_code, 202)
        self.assertFalse(UserProfile.objects.get(user__email='new@example.com').email_verified)
        self.assertEqual(self.client.post(reverse('create_extension_token')).status_code, 403)

    @override_settings(SIGNUP_REQUIRES_INVITE=True)
    def test_the_site_learns_when_an_invite_is_needed(self):
        self.assertEqual(self.client.get(reverse('auth_csrf')).json()['signup_requires_invite'], True)


def google_payload(email):
    return {
        'iss': 'https://accounts.google.com',
        'email_verified': True,
        'sub': 'google-' + email,
        'email': email,
    }


@override_settings(LOCAL_AUTH_BYPASS=False, ADMIN_EMAIL=ADMIN_EMAIL, GOOGLE_CLIENT_ID='google-client-id')
class AdminAccessTests(TestCase):
    def setUp(self):
        cache.clear()

    def create_password_account(self, email, **fields):
        user = User.objects.create_user(username=email, email=email, password=PASSWORD, **fields)
        UserProfile.objects.create(user=user, email_verified=True)
        return user

    def sign_in_with_google(self, client, email):
        with patch('api.views.auth_google.google_id_token.verify_oauth2_token', return_value=google_payload(email)):
            response = client.post(reverse('authenticate_with_google'), {'id_token': 'valid-google-token'})
        self.assertEqual(response.status_code, 200)

    def test_admin_email_signed_in_with_google_gets_in_and_becomes_superuser(self):
        owner = self.create_password_account(ADMIN_EMAIL)
        client = Client()
        self.sign_in_with_google(client, ADMIN_EMAIL)

        self.assertEqual(client.get('/admin/').status_code, 200)
        owner.refresh_from_db()
        self.assertTrue(owner.is_staff and owner.is_superuser)
        self.assertEqual(client.get('/admin/api/invitecode/').status_code, 200)

    def test_admin_email_signed_in_with_a_password_is_sent_to_the_site_login(self):
        self.create_password_account(ADMIN_EMAIL, is_staff=True, is_superuser=True)
        client = Client()
        login = client.post(reverse('auth_login'), {'email': ADMIN_EMAIL, 'password': PASSWORD})
        self.assertEqual(login.status_code, 200)

        response = client.get('/admin/', follow=True)
        self.assertEqual(response.redirect_chain[-1], ('/login', 302))

    def test_another_staff_account_signed_in_with_google_is_refused(self):
        self.create_password_account('staff@example.com', is_staff=True, is_superuser=True)
        client = Client()
        self.sign_in_with_google(client, 'staff@example.com')

        self.assertEqual(client.get('/admin/').status_code, 302)
        self.assertEqual(client.get('/admin/api/invitecode/').status_code, 302)

    def test_admin_login_page_sends_people_to_the_site_login(self):
        response = self.client.get('/admin/login/')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/login')

    @override_settings(ADMIN_EMAIL='')
    def test_nobody_gets_in_without_an_admin_email(self):
        self.create_password_account(ADMIN_EMAIL, is_staff=True, is_superuser=True)
        client = Client()
        self.sign_in_with_google(client, ADMIN_EMAIL)
        self.assertEqual(client.get('/admin/').status_code, 302)
