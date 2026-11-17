from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.test import Client, RequestFactory, TestCase
from django.urls import reverse

from api.client_address import client_ip
from classification.tests.helpers import create_verified_user


class ClientAddressTests(TestCase):
    def test_the_address_nginx_sets_wins_over_x_forwarded_for(self):
        request = RequestFactory().get(
            '/', HTTP_X_REAL_IP='203.0.113.7', HTTP_X_FORWARDED_FOR='198.51.100.1', REMOTE_ADDR='172.18.0.5')
        self.assertEqual(client_ip(request), '203.0.113.7')

    def test_without_nginx_the_socket_address_is_used(self):
        request = RequestFactory().get('/', HTTP_X_FORWARDED_FOR='198.51.100.1', REMOTE_ADDR='127.0.0.1')
        self.assertEqual(client_ip(request), '127.0.0.1')

    def test_a_spoofed_x_forwarded_for_does_not_escape_the_per_address_limit(self):
        # Anonymous feedback is limited to 20 an hour per address.
        cache.clear()
        for attempt in range(20):
            response = self.client.post(
                reverse('create_feedback'), {'source': 'site', 'text': 'Hello'},
                content_type='application/json',
                HTTP_X_REAL_IP='203.0.113.7', HTTP_X_FORWARDED_FOR=f'198.51.100.{attempt}')
            self.assertEqual(response.status_code, 201)

        spoofed = self.client.post(
            reverse('create_feedback'), {'source': 'site', 'text': 'Hello'},
            content_type='application/json',
            HTTP_X_REAL_IP='203.0.113.7', HTTP_X_FORWARDED_FOR='198.51.100.250')
        self.assertEqual(spoofed.status_code, 429)

        other_address = self.client.post(
            reverse('create_feedback'), {'source': 'site', 'text': 'Hello'},
            content_type='application/json', HTTP_X_REAL_IP='203.0.113.8')
        self.assertEqual(other_address.status_code, 201)


class SiteAddressTests(TestCase):
    """Checks every address in SITE_URL and EXTRA_SITE_URLS from the environment."""

    def test_every_site_address_serves_the_api_and_passes_csrf(self):
        user = create_verified_user('reader@example.com')
        for site_url in settings.SITE_URLS:
            host = urlparse(site_url).hostname
            self.assertEqual(self.client.get(reverse('health_check'), HTTP_HOST=host).status_code, 200)

            client = Client(enforce_csrf_checks=True)
            client.force_login(user)
            client.get(reverse('auth_csrf'), HTTP_HOST=host, HTTP_X_FORWARDED_PROTO='https')
            response = client.post(
                reverse('create_feedback'), {'source': 'site', 'text': 'Hello'},
                content_type='application/json',
                HTTP_HOST=host,
                HTTP_X_FORWARDED_PROTO='https',
                HTTP_ORIGIN=site_url,
                HTTP_REFERER=site_url + '/dashboard',
                HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value,
            )
            self.assertEqual(response.status_code, 201, site_url)

    def test_an_unknown_host_is_refused(self):
        self.assertEqual(self.client.get(reverse('health_check'), HTTP_HOST='evil.example').status_code, 400)
