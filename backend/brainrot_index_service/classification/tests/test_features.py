import json
from unittest.mock import patch

from django.test import TestCase, override_settings

from classification.features import (
    features_prompt,
    filter_score,
    features_used,
    parse_scores,
    run_feature_scoring,
    scores_schema,
)
from classification.models import FeatureSet, Post, PostFeatureScores

from .helpers import model_response

FOUR_LEVELS = {
    'name': 'pull', 'description': 'How much it grabs attention.',
    'levels': [
        {'text': 'Calm.', 'examples': ['A library notice.']},
        {'text': 'Some hooks.', 'examples': []},
        {'text': 'Hook-driven.', 'examples': []},
        {'text': 'Relentless.', 'examples': ['A neon slime clip.']},
    ],
}
THREE_LEVELS = {
    'name': 'humor', 'description': 'Would a reader laugh.',
    'levels': [{'text': 'Not a joke.', 'examples': []}, {'text': 'Stings.', 'examples': []},
               {'text': 'Funny.', 'examples': []}],
}


class FeaturePromptTests(TestCase):
    def test_levels_sit_at_even_points_from_0_to_10_with_their_examples(self):
        prompt = features_prompt([FOUR_LEVELS, THREE_LEVELS])

        self.assertIn('pull: How much it grabs attention.\n  0: Calm.\n     For example: A library notice.\n'
                      '  3.3: Some hooks.\n  6.7: Hook-driven.\n  10: Relentless.', prompt)
        self.assertIn('humor: Would a reader laugh.\n  0: Not a joke.\n  5: Stings.\n  10: Funny.', prompt)

    def test_the_answer_is_one_number_from_0_to_10_per_feature(self):
        features = [FOUR_LEVELS, THREE_LEVELS]
        self.assertEqual(scores_schema(features)['required'], ['pull', 'humor'])
        self.assertEqual(parse_scores('{"pull": 4, "humor": 10}', features), {'pull': 4, 'humor': 10})
        # The levels of a four level feature sit at 3.3 and 6.7, and the model answers with those points.
        self.assertEqual(parse_scores('{"pull": 6.7, "humor": 0}', features), {'pull': 6.7, 'humor': 0})
        for answer in ['{"pull": 11, "humor": 0}', '{"pull": true, "humor": 0}', '{"pull": 4}',
                       '{"pull": 4, "humor": 1, "reasoning": "x"}', '{"pull": "4", "humor": 1}', 'not json']:
            self.assertIsNone(parse_scores(answer, features), answer)


class FilterScoreTests(TestCase):
    def test_a_product_is_high_only_when_every_feature_is(self):
        brainrot = {'plugin': 'brainrot', 'form': 'product', 'features': ['pull', 'emptiness'], 'cutoff': 50}
        self.assertEqual(filter_score(brainrot, {'pull': 7, 'emptiness': 8}), 56)
        self.assertEqual(filter_score(brainrot, {'pull': 10, 'emptiness': 0}), 0)
        self.assertEqual(features_used(brainrot), ['pull', 'emptiness'])

    def test_a_weighted_sum_stays_within_0_and_100(self):
        rude = {'plugin': 'rude-or-toxic', 'form': 'weighted_sum', 'weights': {'hostility': 10, 'humor': -6},
                'cutoff': 60}
        self.assertEqual(filter_score(rude, {'hostility': 8, 'humor': 5}), 50)
        self.assertEqual(filter_score(rude, {'hostility': 2, 'humor': 10}), 0)
        self.assertEqual(filter_score({**rude, 'weights': {'hostility': 20}}, {'hostility': 9}), 100)
        self.assertEqual(features_used(rude), ['hostility', 'humor'])


class FirstFeatureSetTests(TestCase):
    def test_version_1_holds_the_starting_definitions(self):
        feature_set = FeatureSet.objects.get(version=1)
        names = [feature['name'] for feature in feature_set.features]
        self.assertEqual(names, ['pull', 'emptiness', 'reply_hook', 'hostility', 'humor'])
        self.assertEqual([filter_definition['plugin'] for filter_definition in feature_set.filters],
                         ['brainrot', 'engagement-bait', 'low-effort', 'rude-or-toxic'])
        for filter_definition in feature_set.filters:
            self.assertLessEqual(set(features_used(filter_definition)), set(names))
        for feature in feature_set.features:
            for level in feature['levels']:
                self.assertTrue(1 <= len(level['examples']) <= 2)

    def test_version_2_lowers_only_the_brainrot_cutoff(self):
        first = FeatureSet.objects.get(version=1)
        second = FeatureSet.objects.get(version=2)
        self.assertEqual(second.features, first.features)
        cutoffs = {filter_definition['plugin']: filter_definition['cutoff'] for filter_definition in second.filters}
        self.assertEqual(cutoffs, {'brainrot': 40, 'engagement-bait': 50, 'low-effort': 80, 'rude-or-toxic': 60})

    def test_a_feature_set_is_immutable(self):
        feature_set = FeatureSet.objects.get(version=1)
        with self.assertRaises(ValueError):
            feature_set.save()


@override_settings(INFERENCE_SOURCE='openrouter', OPENROUTER_API_KEY='test-key', OPENROUTER_MODEL='test/model')
class FeatureScoringTests(TestCase):
    def test_one_call_scores_every_feature_with_the_post_last_and_records_cached_tokens(self):
        post = Post.objects.create(platform='x', post_id='1', kind='post', text='lol')
        feature_set = FeatureSet.objects.get(version=1)
        post_feature_scores = PostFeatureScores.objects.create(post=post, feature_set=feature_set)
        sent = []

        def answer(url, **request):
            sent.append(request['json'])
            response = model_response({'pull': 1, 'emptiness': 10, 'reply_hook': 0, 'hostility': 0, 'humor': 2})
            body = response.json.return_value
            body['usage']['prompt_tokens_details'] = {'cached_tokens': 800}
            response.text = json.dumps(body)
            return response

        with patch('classification.inference.requests.post', side_effect=answer):
            run_feature_scoring(post_feature_scores)

        post_feature_scores.refresh_from_db()
        self.assertEqual(len(sent), 1)
        self.assertEqual(post_feature_scores.status, 'done')
        self.assertEqual(post_feature_scores.scores['emptiness'], 10)
        self.assertEqual(post_feature_scores.cached_prompt_tokens, 800)
        self.assertEqual(sent[0]['response_format']['json_schema']['name'], 'feature_scores')
        system, user = sent[0]['messages']
        self.assertEqual(system['content'], features_prompt(feature_set.features))
        self.assertIn('Text:\nlol', user['content'][0]['text'])
