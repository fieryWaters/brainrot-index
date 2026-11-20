from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.urls import reverse

from api.models import UserProfile
from classification.models import Classification, Plugin, PluginVersion, Post
from classification.tests.helpers import bearer, create_user_with_token, create_verified_user, fake_model_scoring, seen_post
from classification.views import MAX_ENABLED_PLUGINS
from families.models import ROLE_CHILD, Family, FamilyMember
from store.models import PluginRating, PluginReport
from store.rubric import PUBLISHED_PLUGIN_LABELS


RUBRIC = 'Flag posts that are mostly about crypto price predictions, token shilling, or pump and dump hype.'


def publish(client, name='Crypto hype', **overrides):
    body = {
        'name': name,
        'description': 'Hides crypto price hype and token shilling.',
        'author_name': 'Sam',
        'rubric': RUBRIC,
        'default_threshold': 55,
    }
    body.update(overrides)
    return client.post(reverse('store_plugins'), body, content_type='application/json')


def make_child(user, family_owner):
    family = Family.objects.create(name='The Smiths', created_by=family_owner)
    FamilyMember.objects.create(user=family_owner, family=family, role='admin')
    FamilyMember.objects.create(user=user, family=family, role=ROLE_CHILD)


class PublishTests(TestCase):
    def setUp(self):
        self.author = create_verified_user('author@example.com')
        self.client.force_login(self.author)

    def test_publishing_wraps_the_rubric_in_the_fixed_frame(self):
        response = publish(self.client)
        self.assertEqual(response.status_code, 201)
        plugin = Plugin.objects.get(slug=response.json()['slug'])
        self.assertEqual(plugin.author, self.author)
        self.assertEqual(plugin.default_threshold, 55)

        version = plugin.latest_version()
        self.assertEqual(version.version, 1)
        self.assertEqual(version.author_rubric, RUBRIC)
        self.assertTrue(version.rubric_prompt.startswith('You are a content classifier for Brainrot Index'))
        self.assertIn('RUBRIC START\n' + RUBRIC + '\nRUBRIC END', version.rubric_prompt)
        self.assertEqual(version.allowed_labels, PUBLISHED_PLUGIN_LABELS)

    def test_length_limits(self):
        self.assertEqual(publish(self.client, rubric='too short').status_code, 400)
        self.assertEqual(publish(self.client, rubric='x' * 4001).status_code, 400)
        self.assertEqual(publish(self.client, name='x' * 61).status_code, 400)
        self.assertEqual(publish(self.client, default_threshold=101).status_code, 400)

    def test_names_are_unique_regardless_of_case(self):
        publish(self.client)
        self.assertEqual(publish(self.client, name='CRYPTO HYPE').status_code, 400)

    def test_new_version_leaves_the_old_one_unchanged(self):
        slug = publish(self.client).json()['slug']
        first_version = Plugin.objects.get(slug=slug).latest_version()

        new_rubric = RUBRIC + ' Also flag NFT giveaways.'
        response = self.client.post(
            reverse('store_plugin_versions', args=[slug]), {'rubric': new_rubric}, content_type='application/json')
        self.assertEqual(response.json(), {'version': 2})

        first_version.refresh_from_db()
        self.assertEqual(first_version.author_rubric, RUBRIC)
        self.assertEqual(Plugin.objects.get(slug=slug).latest_version().author_rubric, new_rubric)

    def test_a_saved_version_cannot_be_edited(self):
        slug = publish(self.client).json()['slug']
        version = PluginVersion.objects.get(plugin__slug=slug)
        version.rubric_prompt = 'changed'
        with self.assertRaises(ValueError):
            version.save()

    def test_only_the_author_publishes_versions(self):
        slug = publish(self.client).json()['slug']
        other = create_verified_user('other@example.com')
        self.client.force_login(other)
        response = self.client.post(
            reverse('store_plugin_versions', args=[slug]), {'rubric': RUBRIC}, content_type='application/json')
        self.assertEqual(response.status_code, 404)

    def test_publishing_needs_a_verified_email(self):
        UserProfile.objects.filter(user=self.author).update(email_verified=False)
        response = publish(self.client)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'email_not_verified')
        self.assertEqual(self.client.get(reverse('store_plugins')).status_code, 200)

    def test_child_cannot_publish(self):
        child = create_verified_user('kid@example.com')
        make_child(child, self.author)
        self.client.force_login(child)
        self.assertEqual(publish(self.client).status_code, 403)
        self.assertFalse(Plugin.objects.filter(name='Crypto hype').exists())


class InstallTests(TestCase):
    def setUp(self):
        self.author = create_verified_user('author@example.com')
        self.client.force_login(self.author)
        self.slug = publish(self.client).json()['slug']
        self.reader, self.token = create_user_with_token('reader@example.com')
        self.client.force_login(self.reader)

    def install(self, slug=None):
        return self.client.post(reverse('installed_plugins'), {'slug': slug or self.slug}, content_type='application/json')

    def installed_slugs(self):
        return [plugin['slug'] for plugin in self.client.get(reverse('installed_plugins')).json()['plugins']]

    def test_install_uses_the_default_threshold_and_uninstall_removes_it(self):
        response = self.install()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['threshold'], 55)
        self.assertIn(self.slug, self.installed_slugs())

        response = self.client.delete(reverse('installed_plugin', args=[self.slug]))
        self.assertEqual(response.status_code, 204)
        self.assertNotIn(self.slug, self.installed_slugs())

    def test_baseline_plugins_stay_installed_by_default(self):
        self.assertEqual(self.installed_slugs(), ['engagement-bait', 'brainrot', 'rude-or-toxic', 'low-effort'])

    @patch('classification.views.PENDING_WAIT_SECONDS', 0)
    def test_an_uninstalled_plugin_does_not_run(self):
        plugin_version = Plugin.objects.get(slug=self.slug).latest_version()
        self.client.post(reverse('classify'), {'posts': [seen_post('p1')]}, content_type='application/json', **bearer(self.token))
        self.assertFalse(Classification.objects.filter(plugin_version=plugin_version).exists())

        self.install()
        self.client.post(reverse('classify'), {'posts': [seen_post('p2')]}, content_type='application/json', **bearer(self.token))
        self.assertTrue(Classification.objects.filter(plugin_version=plugin_version, post__post_id='p2').exists())

    @patch('classification.views.PENDING_WAIT_SECONDS', 0)
    def test_a_turned_off_plugin_does_not_run(self):
        self.install()
        self.client.patch(reverse('installed_plugin', args=[self.slug]), {'enabled': False}, content_type='application/json')
        self.client.post(reverse('classify'), {'posts': [seen_post('p1')]}, content_type='application/json', **bearer(self.token))
        plugin_version = Plugin.objects.get(slug=self.slug).latest_version()
        self.assertFalse(Classification.objects.filter(plugin_version=plugin_version).exists())

    def test_enabled_plugins_are_capped(self):
        self.client.force_login(self.author)
        extra_slugs = [publish(self.client, name=f'Extra plugin {number}').json()['slug'] for number in range(6)]
        self.client.force_login(self.reader)

        # Four baseline plugins are on; four more reach the cap.
        for slug in extra_slugs[:MAX_ENABLED_PLUGINS - 4]:
            self.assertEqual(self.install(slug).status_code, 201)
        response = self.install(extra_slugs[5])
        self.assertEqual(response.status_code, 400)
        self.assertIn('At most 8 plugins can be on at once', response.json()['error'])

        # Turning one off makes room; turning it back on while full is refused.
        self.client.patch(reverse('installed_plugin', args=['rude-or-toxic']), {'enabled': False}, content_type='application/json')
        self.assertEqual(self.install(extra_slugs[5]).status_code, 201)
        response = self.client.patch(
            reverse('installed_plugin', args=['rude-or-toxic']), {'enabled': True}, content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_unlisted_plugin_cannot_be_installed_but_keeps_running_for_existing_installs(self):
        self.install()
        Plugin.objects.filter(slug=self.slug).update(is_listed=False)
        self.assertIn(self.slug, self.installed_slugs())

        newcomer = create_verified_user('new@example.com')
        self.client.force_login(newcomer)
        self.assertEqual(self.install().status_code, 404)
        store_slugs = [plugin['slug'] for plugin in self.client.get(reverse('store_plugins')).json()['plugins']]
        self.assertNotIn(self.slug, store_slugs)

    def test_child_cannot_install_or_uninstall(self):
        make_child(self.reader, self.author)
        self.assertEqual(self.install().status_code, 403)
        self.assertEqual(self.client.delete(reverse('installed_plugin', args=['rude-or-toxic'])).status_code, 403)
        self.assertIn('rude-or-toxic', self.installed_slugs())


class StoreBrowsingTests(TestCase):
    def setUp(self):
        self.author = create_verified_user('author@example.com')
        self.client.force_login(self.author)
        self.slug = publish(self.client).json()['slug']
        self.reader = create_verified_user('reader@example.com')
        self.client.force_login(self.reader)

    def test_list_shows_counts_and_search_filters(self):
        self.client.post(reverse('installed_plugins'), {'slug': self.slug}, content_type='application/json')
        PluginRating.objects.create(user=self.reader, plugin=Plugin.objects.get(slug=self.slug), stars=4)

        plugins = {plugin['slug']: plugin for plugin in self.client.get(reverse('store_plugins')).json()['plugins']}
        self.assertEqual(plugins[self.slug]['install_count'], 1)
        self.assertEqual(plugins[self.slug]['average_rating'], 4.0)
        self.assertEqual(plugins[self.slug]['author_name'], 'Sam')
        self.assertTrue(plugins[self.slug]['installed'])
        self.assertEqual(plugins['ragebait']['author_name'], 'BrainRot Index')

        found = self.client.get(reverse('store_plugins'), {'q': 'shilling'}).json()['plugins']
        self.assertEqual([plugin['slug'] for plugin in found], [self.slug])

    def test_official_plugins_are_listed_but_not_installed(self):
        official_slugs = ['money-hype', 'self-harm-adjacent', 'doom-framing', 'hidden-promo']
        plugins = {plugin['slug']: plugin for plugin in self.client.get(reverse('store_plugins')).json()['plugins']}
        self.assertNotIn('body-pressure', plugins)
        for slug in official_slugs:
            self.assertEqual(plugins[slug]['author_name'], 'Brainrot Index')
            self.assertFalse(plugins[slug]['installed'])
        self.assertFalse(plugins['doom-framing']['suggested_for_children'])
        self.assertTrue(plugins['self-harm-adjacent']['suggested_for_children'])

        installed = self.client.get(reverse('installed_plugins')).json()['plugins']
        self.assertFalse({plugin['slug'] for plugin in installed} & set(official_slugs))

    def test_detail_shows_the_authors_rubric_and_cached_samples(self):
        post = Post.objects.create(platform='reddit', post_id='p1', kind='post', text='BTC to 1M by Friday, buy now')
        version = Plugin.objects.get(slug=self.slug).latest_version()
        Classification.objects.create(
            post=post, plugin_version=version, status='done', score=90, label='flagged', reasoning='Price hype.')

        detail = self.client.get(reverse('store_plugin', args=[self.slug])).json()
        self.assertEqual(detail['rubric'], RUBRIC)
        self.assertFalse(detail['is_author'])
        self.assertEqual(detail['samples'], [{
            'platform': 'reddit', 'text': 'BTC to 1M by Friday, buy now', 'score': 90,
            'label': 'flagged', 'reasoning': 'Price hype.',
        }])


class RatingAndReportTests(TestCase):
    def setUp(self):
        self.author = create_verified_user('author@example.com')
        self.client.force_login(self.author)
        self.slug = publish(self.client).json()['slug']
        self.reader = create_verified_user('reader@example.com')
        self.client.force_login(self.reader)

    def rate(self, stars, review=''):
        return self.client.put(
            reverse('store_plugin_rating', args=[self.slug]), {'stars': stars, 'review': review},
            content_type='application/json')

    def test_rating_needs_the_plugin_installed(self):
        response = self.rate(5)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'Install a plugin before rating it.')

    def test_one_rating_per_user_which_can_be_changed(self):
        self.client.post(reverse('installed_plugins'), {'slug': self.slug}, content_type='application/json')
        self.assertEqual(self.rate(5, 'Works well').status_code, 200)
        self.assertEqual(self.rate(2).status_code, 200)
        rating = PluginRating.objects.get(user=self.reader)
        self.assertEqual(rating.stars, 2)
        self.assertEqual(PluginRating.objects.filter(plugin__slug=self.slug).count(), 1)
        self.assertEqual(self.rate(6).status_code, 400)

    def test_child_cannot_rate(self):
        self.client.post(reverse('installed_plugins'), {'slug': self.slug}, content_type='application/json')
        make_child(self.reader, self.author)
        self.assertEqual(self.rate(5).status_code, 403)

    def test_report_is_stored(self):
        response = self.client.post(
            reverse('store_plugin_report', args=[self.slug]), {'reason': 'Hides every post about money.'},
            content_type='application/json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(PluginReport.objects.get().reason, 'Hides every post about money.')


@override_settings(INFERENCE_SOURCE='openrouter', OPENROUTER_MODEL='test/model')
class TryRubricTests(TestCase):
    def setUp(self):
        cache.clear()
        self.user = create_verified_user('author@example.com')
        self.client.force_login(self.user)

    def try_rubric(self, rubric=RUBRIC):
        return self.client.post(
            reverse('store_try'), {'rubric': rubric, 'text': 'BTC to 1M by Friday'}, content_type='application/json')

    def test_try_sends_the_framed_rubric_and_returns_the_answer(self):
        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(80)) as model_call:
            response = self.try_rubric()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['score'], 80)
        request = model_call.call_args.kwargs['json']
        self.assertIn('RUBRIC START\n' + RUBRIC, request['messages'][0]['content'])
        self.assertEqual(request['response_format']['json_schema']['schema']['properties']['label']['enum'], PUBLISHED_PLUGIN_LABELS)

    def test_try_is_rate_limited(self):
        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)):
            statuses = [self.try_rubric().status_code for _ in range(21)]
        self.assertEqual(statuses[:20], [200] * 20)
        self.assertEqual(statuses[20], 429)

    @override_settings(DAILY_NEW_POST_QUOTA=1)
    def test_each_try_counts_against_the_daily_quota(self):
        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)) as model_call:
            self.assertEqual(self.try_rubric().status_code, 200)
            self.assertEqual(self.try_rubric().status_code, 429)
        self.assertEqual(model_call.call_count, 1)

    def test_child_cannot_try(self):
        owner = create_verified_user('parent@example.com')
        make_child(self.user, owner)
        self.assertEqual(self.try_rubric().status_code, 403)
