from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from classification.models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_FAILED,
    Classification,
    Post,
    UserPlugin,
)
from classification.worker import classify_next_pending

from .helpers import bearer, create_user_with_token, fake_model_scoring, seen_post


def run_worker_until_idle():
    while classify_next_pending():
        pass


@patch('classification.views.PENDING_WAIT_SECONDS', 0)
class ClassifyEndpointTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')

    def classify(self, posts, token=None):
        return self.client.post(
            reverse('classify'),
            {'posts': posts},
            content_type='application/json',
            **bearer(token or self.token),
        )

    def set_score(self, post_id, plugin_slug, score):
        Classification.objects.filter(
            post__post_id=post_id,
            plugin_version__plugin__slug=plugin_slug,
        ).update(status=CLASSIFICATION_DONE, score=score, label='flagged_label')

    def test_new_post_is_pending_until_every_plugin_is_done(self):
        response = self.classify([seen_post('p1')])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'results': [{'platform': 'reddit', 'post_id': 'p1', 'status': 'pending'}]})
        self.assertEqual(Classification.objects.filter(post__post_id='p1').count(), 4)

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)):
            run_worker_until_idle()

        response = self.classify([seen_post('p1')])
        self.assertEqual(response.json(), {'results': [{
            'platform': 'reddit', 'post_id': 'p1', 'status': 'done', 'action': 'allow', 'reasons': [],
        }]})

    def test_second_user_seeing_the_same_post_triggers_no_new_inference(self):
        self.classify([seen_post('p1')])
        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)) as model_call:
            run_worker_until_idle()
        self.assertEqual(model_call.call_count, 4)

        _, other_token = create_user_with_token('other@example.com')
        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)) as model_call:
            response = self.classify([seen_post('p1', text='Text edited after first sight')], token=other_token)
            run_worker_until_idle()

        self.assertEqual(model_call.call_count, 0)
        self.assertEqual(response.json()['results'][0]['status'], 'done')
        self.assertEqual(Classification.objects.count(), 4)
        self.assertEqual(Post.objects.get(post_id='p1').text, 'A photo of my garden this morning.')

    def test_action_follows_the_users_threshold_and_flagged_action(self):
        self.classify([seen_post('p1')])
        for slug in ['engagement-bait', 'ragebait', 'brainrot', 'ai-slop']:
            self.set_score('p1', slug, 10)
        self.set_score('p1', 'ragebait', 70)

        result = self.classify([seen_post('p1')]).json()['results'][0]
        self.assertEqual(result['action'], 'hide')
        self.assertEqual(result['reasons'], [{'plugin': 'Ragebait', 'label': 'flagged_label', 'score': 70}])

        UserPlugin.objects.filter(user=self.user, plugin__slug='ragebait').update(threshold=80)
        result = self.classify([seen_post('p1')]).json()['results'][0]
        self.assertEqual(result['action'], 'allow')
        self.assertEqual(result['reasons'], [])

    def test_score_equal_to_threshold_is_flagged(self):
        self.classify([seen_post('p1')])
        for slug in ['engagement-bait', 'ragebait', 'brainrot', 'ai-slop']:
            self.set_score('p1', slug, 60)
        UserPlugin.objects.filter(user=self.user).update(flagged_action='blur')

        result = self.classify([seen_post('p1')]).json()['results'][0]
        self.assertEqual(result['action'], 'blur')
        self.assertEqual(len(result['reasons']), 4)

    def test_hide_wins_over_blur(self):
        self.classify([seen_post('p1')])
        for slug in ['engagement-bait', 'ragebait', 'brainrot', 'ai-slop']:
            self.set_score('p1', slug, 90)
        UserPlugin.objects.filter(user=self.user).update(flagged_action='blur')
        UserPlugin.objects.filter(user=self.user, plugin__slug='brainrot').update(flagged_action='hide')

        result = self.classify([seen_post('p1')]).json()['results'][0]
        self.assertEqual(result['action'], 'hide')

    def test_failed_classification_counts_as_finished_without_flag(self):
        self.classify([seen_post('p1')])
        for slug in ['engagement-bait', 'ragebait', 'brainrot']:
            self.set_score('p1', slug, 10)
        Classification.objects.filter(plugin_version__plugin__slug='ai-slop').update(status=CLASSIFICATION_FAILED)

        result = self.classify([seen_post('p1')]).json()['results'][0]
        self.assertEqual(result['status'], 'done')
        self.assertEqual(result['action'], 'allow')

    def test_disabled_plugin_is_not_waited_for(self):
        self.classify([seen_post('p1')])
        for slug in ['engagement-bait', 'ragebait', 'brainrot']:
            self.set_score('p1', slug, 10)
        UserPlugin.objects.filter(user=self.user, plugin__slug='ai-slop').update(enabled=False)

        result = self.classify([seen_post('p1')]).json()['results'][0]
        self.assertEqual(result['status'], 'done')

    def test_more_than_25_posts_is_rejected(self):
        response = self.classify([seen_post(f'p{number}') for number in range(26)])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Post.objects.count(), 0)

    def test_25_posts_are_accepted(self):
        response = self.classify([seen_post(f'p{number}') for number in range(25)])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['results']), 25)

    def test_reply_keeps_its_parent_and_post_drops_it(self):
        self.classify([
            seen_post('t1', kind='reply', parent_post_id='p1'),
            seen_post('p2', parent_post_id='ignored'),
        ])
        self.assertEqual(Post.objects.get(post_id='t1').parent_post_id, 'p1')
        self.assertEqual(Post.objects.get(post_id='p2').parent_post_id, '')

    def test_missing_or_invalid_token_is_401(self):
        no_token = self.client.post(reverse('classify'), {'posts': []}, content_type='application/json')
        wrong_token = self.classify([], token='not-a-real-token')
        self.assertEqual(no_token.status_code, 401)
        self.assertEqual(wrong_token.status_code, 401)

    def test_session_cookie_alone_is_not_accepted(self):
        self.client.force_login(self.user)
        response = self.client.post(reverse('classify'), {'posts': []}, content_type='application/json')
        self.assertEqual(response.status_code, 401)
