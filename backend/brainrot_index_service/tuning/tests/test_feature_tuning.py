import io
from unittest.mock import patch

from django.core.management import call_command
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from api.sign_in import SIGN_IN_GOOGLE
from classification.models import CLASSIFICATION_DONE, Classification, FeatureSet, Plugin, Post, PostJudgment
from classification.tests.helpers import create_verified_user, model_response
from feedback.tests.test_inbox import signed_in_client
from tuning.feature_runs import run_next_feature_experiment
from tuning.models import FeatureExperiment

OWNER_EMAIL = 'owner@example.com'

# The stand-in model's ratings by the post's text.
RATINGS = {
    'lol': {'pull': 6, 'emptiness': 10, 'reply_hook': 0, 'hostility': 0, 'humor': 0},
    'lol lol': {'pull': 6, 'emptiness': 10, 'reply_hook': 0, 'hostility': 0, 'humor': 0},
    'You idiots': {'pull': 0, 'emptiness': 6, 'reply_hook': 0, 'hostility': 9, 'humor': 0},
    'crypto scam': {'pull': 0, 'emptiness': 9, 'reply_hook': 0, 'hostility': 0, 'humor': 0},
    'A thoughtful explanation': {'pull': 0, 'emptiness': 0, 'reply_hook': 0, 'hostility': 0, 'humor': 0},
}


def fake_model(requests_sent):
    """Rates features by the post's text; every live rubric finds no criterion met (score 0)."""
    def answer(url, **request):
        body = request['json']
        requests_sent.append(body)
        schema_name = body['response_format']['json_schema']['name']
        properties = body['response_format']['json_schema']['schema']['properties']
        if schema_name == 'explanations':
            return model_response({name: f"Why {name}." for name in properties})
        post_text = body['messages'][1]['content'][0]['text'].split('Text:\n')[1]
        if schema_name == 'feature_scores':
            return model_response(RATINGS[post_text])
        criteria_answers = {name: False for name in properties if name != 'reasoning'}
        return model_response({'reasoning': 'A post.', **criteria_answers})
    return answer


def schema_names(requests_sent):
    return [body['response_format']['json_schema']['name'] for body in requests_sent]


@override_settings(LOCAL_AUTH_BYPASS=False, ADMIN_EMAIL=OWNER_EMAIL, OPENROUTER_API_KEY='test-key',
                   INFERENCE_SOURCE='openrouter', OPENROUTER_MODEL='test/model')
class FeatureTuningTests(TestCase):
    def setUp(self):
        self.owner = create_verified_user(OWNER_EMAIL)
        self.owner_client = signed_in_client(self.owner, SIGN_IN_GOOGLE)
        self.thumbs = {}
        for number, (text, should_be, plugin_slug) in enumerate([
            ('lol', 'shown', None),
            ('lol lol', 'blocked', 'low-effort'),
            ('You idiots', 'blocked', 'rude-or-toxic'),
            ('crypto scam', 'blocked', None),
            ('A thoughtful explanation', 'shown', None),
        ]):
            post = Post.objects.create(platform='x', post_id=str(number), kind='post', text=text)
            plugin = Plugin.objects.get(slug=plugin_slug) if plugin_slug else None
            self.thumbs[text] = PostJudgment.objects.create(
                user=self.owner, post=post, verdict='right', shown_action='allow', should_be=should_be, plugin=plugin)
        # Production already classified one post with the live Rude or Toxic.
        rude = Plugin.objects.get(slug='rude-or-toxic')
        Classification.objects.create(post=self.thumbs['A thoughtful explanation'].post, plugin_version=rude.latest_version(),
                                      status=CLASSIFICATION_DONE, score=5, criteria_met=[], reasoning='Plain.')
        self.feature_set = FeatureSet.objects.get(version=2)

    def draft(self, **overrides):
        draft = {'features': self.feature_set.features, 'filters': self.feature_set.filters,
                 'started_from_feature_set': self.feature_set.id}
        draft.update(overrides)
        return draft

    def run_worker(self):
        requests_sent = []
        with patch('requests.post', side_effect=fake_model(requests_sent)):
            while run_next_feature_experiment():
                pass
        return requests_sent

    def start_experiment(self, **overrides):
        response = self.owner_client.post(reverse('tuning_feature_experiments'), self.draft(**overrides),
                                          content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_each_post_is_rated_once_and_every_filter_measured_on_its_own_test_set(self):
        started = self.start_experiment()
        requests_sent = self.run_worker()

        names = schema_names(requests_sent)
        # Blocked as Other is in no filter's test set: four posts, one rating call each.
        self.assertEqual(names.count('feature_scores'), 4)
        # Live answers: four filters on each post labeled shown, one on each blocked as a filter,
        # less the one production already stored.
        self.assertEqual(names.count('classification'), 4 + 1 + 1 + 3)
        # Explained: the posts some filter gets wrong or decides differently from live.
        self.assertEqual(names.count('explanations'), 3)

        shown = self.owner_client.get(reverse('tuning_feature_experiment', args=[started['id']])).json()
        self.assertEqual(shown['status'], 'done')
        self.assertEqual(shown['scores']['brainrot'], {
            'cases': 2,
            'draft': {'right': 1, 'missed': 0, 'wrongly_flagged': 1, 'failed': 0},
            'live': {'right': 2, 'missed': 0, 'wrongly_flagged': 0, 'failed': 0},
        })
        self.assertEqual(shown['scores']['low-effort'], {
            'cases': 3,
            'draft': {'right': 2, 'missed': 0, 'wrongly_flagged': 1, 'failed': 0},
            'live': {'right': 2, 'missed': 1, 'wrongly_flagged': 0, 'failed': 0},
        })
        self.assertEqual(shown['scores']['rude-or-toxic']['draft']['right'], 3)

        results = {result['post']['text']: result for result in shown['results']}
        self.assertNotIn('crypto scam', results)
        self.assertEqual(results['lol']['expected'],
                         {'brainrot': False, 'engagement-bait': False, 'low-effort': False, 'rude-or-toxic': False})
        self.assertEqual(results['lol']['filter_scores']['brainrot'], 60)
        self.assertEqual(results['lol lol']['expected'], {'low-effort': True})
        self.assertEqual(results['lol']['reasons']['emptiness'], 'Why emptiness.')
        self.assertEqual(results['A thoughtful explanation']['live']['rude-or-toxic']['score'], 5)
        self.assertEqual(results['A thoughtful explanation']['reasons'], {})
        self.assertIn('emptiness: What a reader is left with', shown['system_prompt'])

        # The ratings are the whole answer; reasons come in a follow-up turn of the same conversation.
        rating = next(body for body in requests_sent if schema_names([body]) == ['feature_scores'])
        self.assertEqual(rating['response_format']['json_schema']['schema']['required'],
                         ['pull', 'emptiness', 'reply_hook', 'hostility', 'humor'])
        explanation = next(body for body in requests_sent if schema_names([body]) == ['explanations'])
        self.assertEqual(explanation['messages'][0]['content'], rating['messages'][0]['content'])

    def test_a_second_run_reuses_the_live_answers(self):
        self.start_experiment()
        self.run_worker()
        self.start_experiment()
        self.assertEqual(schema_names(self.run_worker()).count('classification'), 0)

    def test_a_draft_must_define_what_its_filters_use_and_replace_a_live_filter(self):
        undefined = [{'plugin': 'brainrot', 'form': 'product', 'features': ['pull', 'novelty'], 'cutoff': 50}]
        unknown = [{'plugin': 'cat-pictures', 'form': 'weighted_sum', 'weights': {'pull': 10}, 'cutoff': 50}]
        empty = [{'plugin': 'brainrot', 'form': 'weighted_sum', 'weights': {}, 'cutoff': 50}]
        for filters in [undefined, unknown, empty]:
            response = self.owner_client.post(reverse('tuning_feature_experiments'), self.draft(filters=filters),
                                              content_type='application/json')
            self.assertEqual(response.status_code, 400, filters)
        one_level = [{**self.feature_set.features[0], 'levels': self.feature_set.features[0]['levels'][:1]}]
        response = self.owner_client.post(reverse('tuning_feature_experiments'), self.draft(features=one_level),
                                          content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(FeatureExperiment.objects.count(), 0)

    def test_the_overview_starts_from_the_saved_feature_set(self):
        overview = self.owner_client.get(reverse('tuning_features')).json()
        self.assertEqual(overview['feature_set']['version'], 2)
        self.assertEqual({tunable['slug'] for tunable in overview['filters']},
                         {'brainrot', 'engagement-bait', 'low-effort', 'rude-or-toxic'})
        low_effort = next(tunable for tunable in overview['filters'] if tunable['slug'] == 'low-effort')
        self.assertEqual(low_effort['thumb_cases'], 3)

    def test_everyone_but_the_owner_is_refused(self):
        reader_client = signed_in_client(create_verified_user('reader@example.com'), SIGN_IN_GOOGLE)
        for client in [Client(), reader_client]:
            self.assertIn(client.get(reverse('tuning_features')).status_code, [401, 403])
            started = client.post(reverse('tuning_feature_experiments'), self.draft(), content_type='application/json')
            self.assertIn(started.status_code, [401, 403])

    def test_the_command_runs_the_saved_feature_set_and_prints_each_filter(self):
        output = io.StringIO()
        with patch('requests.post', side_effect=fake_model([])):
            call_command('run_feature_experiment', stdout=output)

        experiment = FeatureExperiment.objects.get()
        self.assertEqual(experiment.status, 'done')
        self.assertEqual(experiment.started_from_feature_set, self.feature_set)
        self.assertEqual(experiment.results.count(), 4)
        printed = output.getvalue()
        self.assertIn('== low-effort: draft cutoff 80, live v', printed)
        self.assertIn("owner's thumbs, 3 posts:\n  draft: 2 right, 0 missed, 1 wrongly blocked", printed)
        self.assertIn(f"/tuning/features/{experiment.id}", printed)
        self.assertIn("Rating call alone, per post: 900 prompt tokens (0% read from cache), 60 completion tokens", printed)
        self.assertIn("Production today: no post here was classified by every live filter.", printed)
        # Nothing was left for the worker.
        self.assertFalse(run_next_feature_experiment())

    def test_an_unusable_rating_is_kept_and_printed(self):
        RATINGS_WITH_A_WORD = {**RATINGS, 'lol': {**RATINGS['lol'], 'pull': 'high'}}
        output = io.StringIO()
        with patch.dict(RATINGS, RATINGS_WITH_A_WORD), patch('requests.post', side_effect=fake_model([])):
            call_command('run_feature_experiment', stdout=output)

        result = FeatureExperiment.objects.get().results.get(case_id=f"judgment-{self.thumbs['lol'].id}")
        self.assertTrue(result.failed)
        self.assertIn('high', result.raw_response)
        self.assertIn(f"No usable answer for judgment-{self.thumbs['lol'].id}:", output.getvalue())
