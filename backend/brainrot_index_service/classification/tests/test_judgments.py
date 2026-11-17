from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from classification.models import CLASSIFICATION_DONE, Classification, PostJudgment, UserPlugin

from .helpers import bearer, create_user_with_token, seen_post


@patch('classification.views.PENDING_WAIT_SECONDS', 0)
class JudgmentTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')
        self.client.post(reverse('classify'), {'posts': [seen_post('p1')]}, content_type='application/json', **bearer(self.token))

    def set_score(self, plugin_slug, score):
        Classification.objects.filter(post__post_id='p1', plugin_version__plugin__slug=plugin_slug).update(
            status=CLASSIFICATION_DONE, score=score, label='flagged_label')

    def judge(self, verdict, shown_action='hide', post_id='p1'):
        return self.client.post(
            reverse('create_judgment'),
            {'platform': 'reddit', 'post_id': post_id, 'verdict': verdict, 'shown_action': shown_action, 'extension_commit': 'ext1234'},
            content_type='application/json',
            **bearer(self.token),
        )

    def add_details(self, judgment_id, details):
        return self.client.patch(
            reverse('judgment_details', args=[judgment_id]), details, content_type='application/json', **bearer(self.token))

    def test_thumbs_up_on_a_hidden_post_records_what_every_filter_decided(self):
        self.set_score('engagement-bait', 90)
        self.set_score('ragebait', 50)

        response = self.judge('right')

        self.assertEqual(response.status_code, 201)
        judgment = PostJudgment.objects.get(id=response.json()['id'])
        self.assertEqual(judgment.user, self.user)
        self.assertEqual(judgment.post.post_id, 'p1')
        self.assertEqual(judgment.verdict, 'right')
        self.assertEqual(judgment.shown_action, 'hide')
        self.assertEqual(judgment.extension_commit, 'ext1234')
        # Engagement bait scored highest among the filters that flagged it.
        self.assertEqual(judgment.plugin.slug, 'engagement-bait')
        results = {result['plugin']: result for result in judgment.filter_results}
        self.assertEqual(set(results), {'engagement-bait', 'ragebait', 'brainrot', 'ai-slop'})
        self.assertEqual(results['engagement-bait']['score'], 90)
        self.assertTrue(results['engagement-bait']['flagged'])
        self.assertTrue(results['ragebait']['flagged'])  # its threshold is 40
        self.assertEqual(results['brainrot']['status'], 'pending')
        self.assertFalse(results['brainrot']['flagged'])

    def test_thumbs_down_on_a_shown_post_names_no_filter_until_the_reader_does(self):
        self.set_score('engagement-bait', 10)

        judgment_id = self.judge('wrong', shown_action='allow').json()['id']
        self.assertIsNone(PostJudgment.objects.get(id=judgment_id).plugin)

        response = self.add_details(judgment_id, {'plugin': 'ragebait', 'severity': 'high', 'details': 'Pure outrage farming.'})

        self.assertEqual(response.status_code, 200)
        judgment = PostJudgment.objects.get(id=judgment_id)
        self.assertEqual(judgment.plugin.slug, 'ragebait')
        self.assertEqual(judgment.severity, 'high')
        self.assertEqual(judgment.details, 'Pure outrage farming.')

    def test_judging_again_replaces_the_judgment_and_its_details(self):
        judgment_id = self.judge('right').json()['id']
        self.add_details(judgment_id, {'severity': 'low', 'details': 'Fine either way.'})

        response = self.judge('wrong')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['id'], judgment_id)
        judgment = PostJudgment.objects.get(id=judgment_id)
        self.assertEqual(judgment.verdict, 'wrong')
        self.assertEqual(judgment.severity, '')
        self.assertEqual(judgment.details, '')
        self.assertEqual(PostJudgment.objects.count(), 1)

    def test_only_filters_turned_on_are_recorded(self):
        UserPlugin.objects.filter(user=self.user, plugin__slug='ai-slop').update(enabled=False)
        judgment_id = self.judge('right').json()['id']
        recorded = [result['plugin'] for result in PostJudgment.objects.get(id=judgment_id).filter_results]
        self.assertNotIn('ai-slop', recorded)

    def test_a_post_never_sent_cannot_be_judged(self):
        self.assertEqual(self.judge('right', post_id='never-sent').status_code, 404)

    def test_details_of_another_account_cannot_be_changed(self):
        judgment_id = self.judge('right').json()['id']
        _, other_token = create_user_with_token('other@example.com')
        response = self.client.patch(
            reverse('judgment_details', args=[judgment_id]), {'severity': 'high'},
            content_type='application/json', **bearer(other_token))
        self.assertEqual(response.status_code, 404)

    def test_unknown_severity_is_rejected(self):
        judgment_id = self.judge('right').json()['id']
        self.assertEqual(self.add_details(judgment_id, {'severity': 'extreme'}).status_code, 400)

    def test_config_lists_the_filters_turned_on(self):
        UserPlugin.objects.filter(user=self.user, plugin__slug='ai-slop').update(enabled=False)
        config = self.client.get(reverse('extension_config'), **bearer(self.token)).json()
        self.assertEqual([plugin['slug'] for plugin in config['plugins']], ['engagement-bait', 'ragebait', 'brainrot'])
        self.assertEqual(config['plugins'][0]['name'], 'Engagement bait')
