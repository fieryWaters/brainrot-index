from django.test import TestCase
from django.urls import reverse

from classification.models import ExtensionToken

from .helpers import bearer, create_user_with_token, create_verified_user


class ExtensionTokenTests(TestCase):
    def setUp(self):
        self.user = create_verified_user('reader@example.com')

    def test_created_token_authenticates_the_extension_and_only_its_hash_is_stored(self):
        self.client.force_login(self.user)
        response = self.client.post(reverse('create_extension_token'))
        self.assertEqual(response.status_code, 201)
        raw_token = response.json()['token']

        stored_token = ExtensionToken.objects.get(user=self.user)
        self.assertNotEqual(stored_token.token_hash, raw_token)
        self.assertIsNone(stored_token.last_used_at)

        self.client.logout()
        config = self.client.get(reverse('extension_config'), **bearer(raw_token))
        self.assertEqual(config.status_code, 200)
        self.assertEqual(config.json(), {
            'enabled': True,
            'mode': 'adult',
            'pending_action': 'allow',
            'allow_reveal': True,
            'platforms': ['reddit', 'x'],
        })
        stored_token.refresh_from_db()
        self.assertIsNotNone(stored_token.last_used_at)

    def test_token_creation_needs_a_session(self):
        response = self.client.post(reverse('create_extension_token'))
        self.assertEqual(response.status_code, 403)

    def test_config_without_valid_token_is_401(self):
        self.assertEqual(self.client.get(reverse('extension_config')).status_code, 401)
        self.assertEqual(self.client.get(reverse('extension_config'), **bearer('wrong')).status_code, 401)

    def test_token_of_deactivated_user_is_401(self):
        user, raw_token = create_user_with_token('gone@example.com')
        user.is_active = False
        user.save()
        self.assertEqual(self.client.get(reverse('extension_config'), **bearer(raw_token)).status_code, 401)


class UserSettingsTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')
        self.client.force_login(self.user)

    def test_child_mode_blurs_pending_posts_and_forbids_reveal(self):
        response = self.client.patch(reverse('user_settings'), {'mode': 'child'}, content_type='application/json')
        self.assertEqual(response.json(), {'enabled': True, 'mode': 'child', 'allow_reveal': True})

        config = self.client.get(reverse('extension_config'), **bearer(self.token)).json()
        self.assertEqual(config['pending_action'], 'blur')
        self.assertFalse(config['allow_reveal'])

    def test_master_switch(self):
        self.client.patch(reverse('user_settings'), {'enabled': False}, content_type='application/json')
        self.assertEqual(self.client.get(reverse('user_settings')).json()['enabled'], False)

    def test_first_use_installs_the_baseline_plugins(self):
        plugins = self.client.get(reverse('installed_plugins')).json()['plugins']
        self.assertEqual([plugin['slug'] for plugin in plugins], ['engagement-bait', 'ragebait', 'brainrot', 'ai-slop'])
        for plugin in plugins:
            self.assertEqual(plugin['enabled'], True)
            self.assertEqual(plugin['flagged_action'], 'hide')
        thresholds = {plugin['slug']: plugin['threshold'] for plugin in plugins}
        self.assertEqual(thresholds, {'engagement-bait': 60, 'ragebait': 40, 'brainrot': 40, 'ai-slop': 30})

    def test_plugin_settings_can_be_changed(self):
        response = self.client.patch(
            reverse('installed_plugin', args=['ragebait']),
            {'threshold': 35, 'flagged_action': 'blur', 'enabled': False},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['threshold'], 35)
        self.assertEqual(response.json()['flagged_action'], 'blur')
        self.assertEqual(response.json()['enabled'], False)

    def test_threshold_outside_0_to_100_is_rejected(self):
        response = self.client.patch(
            reverse('installed_plugin', args=['ragebait']), {'threshold': 101}, content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_unknown_plugin_is_404(self):
        response = self.client.patch(
            reverse('installed_plugin', args=['nope']), {'threshold': 50}, content_type='application/json')
        self.assertEqual(response.status_code, 404)
