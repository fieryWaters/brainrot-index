from django.test import TestCase
from django.urls import reverse

from api.models import ExtensionDataConsent
from classification.models import ExtensionToken

from .helpers import bearer, create_user_with_token

AGREEMENT = {'disclosure_version': '2026-11-17', 'agreed_at': '2026-11-17T10:00:00Z'}


class ExtensionDataConsentTests(TestCase):
    def setUp(self):
        self.user, self.raw_token = create_user_with_token('reader@example.com')

    def test_agreement_is_recorded_once_per_extension_and_wording(self):
        first = self.client.post(reverse('extension_data_consent'), AGREEMENT,
                                 content_type='application/json', **bearer(self.raw_token))
        again = self.client.post(reverse('extension_data_consent'), AGREEMENT,
                                 content_type='application/json', **bearer(self.raw_token))
        self.assertEqual(first.status_code, 201)
        self.assertEqual(again.status_code, 200)

        consent = ExtensionDataConsent.objects.get()
        self.assertEqual(consent.user, self.user)
        self.assertEqual(consent.extension_token, ExtensionToken.objects.get(user=self.user))
        self.assertEqual(consent.disclosure_version, '2026-11-17')
        self.assertEqual(consent.agreed_at.isoformat(), '2026-11-17T10:00:00+00:00')
        self.assertIsNone(consent.withdrawn_at)

    def test_disconnecting_marks_the_agreement_withdrawn_and_keeps_it(self):
        self.client.post(reverse('extension_data_consent'), AGREEMENT,
                         content_type='application/json', **bearer(self.raw_token))
        response = self.client.delete(reverse('extension_data_consent'), **bearer(self.raw_token))
        self.assertEqual(response.status_code, 204)
        self.assertIsNotNone(ExtensionDataConsent.objects.get().withdrawn_at)

    def test_agreement_needs_a_valid_extension_token_and_both_fields(self):
        no_token = self.client.post(reverse('extension_data_consent'), AGREEMENT, content_type='application/json')
        self.assertEqual(no_token.status_code, 401)
        missing_time = self.client.post(reverse('extension_data_consent'), {'disclosure_version': '2026-11-17'},
                                        content_type='application/json', **bearer(self.raw_token))
        self.assertEqual(missing_time.status_code, 400)
        self.assertFalse(ExtensionDataConsent.objects.exists())

    def test_agreement_is_in_the_account_export(self):
        self.client.post(reverse('extension_data_consent'), AGREEMENT,
                         content_type='application/json', **bearer(self.raw_token))
        self.client.force_login(self.user)
        exported = self.client.get(reverse('account_export')).json()
        self.assertEqual(exported['extension_data_consents'], [
            {'disclosure_version': '2026-11-17', 'agreed_at': '2026-11-17T10:00:00+00:00', 'withdrawn_at': None},
        ])
