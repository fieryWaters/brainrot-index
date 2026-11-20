import io
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings

from classification.models import Classification, Plugin, Post, PostJudgment
from classification.views import store_post
from feedback.models import Feedback

from .helpers import create_user_with_token, fake_model_scoring, model_response, seen_post


def labeled_example(example_id, ragebait_flag, text='Great point!'):
    return {
        'id': example_id,
        'source': 'synthetic',
        'platform': 'x',
        'kind': 'reply',
        'community': '',
        'text': text,
        'parent_text': 'We just shipped version 2 of our compiler.',
        'expected': {'ragebait': {'flag': ragebait_flag, 'difficulty': 'clear', 'why': 'test'}},
    }


def write_dataset(directory, examples):
    dataset_path = Path(directory) / 'dataset.jsonl'
    dataset_path.write_text(''.join(json.dumps(example) + '\n' for example in examples))
    return dataset_path


def evaluate(dataset_path):
    output = io.StringIO()
    call_command(
        'evaluate_plugins',
        dataset=str(dataset_path),
        inference_source='openrouter',
        model='test/model',
        stdout=output,
    )
    return output.getvalue()


@override_settings(OPENROUTER_API_KEY='test-key')
class EvaluatePluginsTests(TestCase):
    def test_scores_examples_without_touching_production_tables(self):
        with tempfile.TemporaryDirectory() as directory:
            dataset_path = write_dataset(directory, [labeled_example('a', True), labeled_example('b', False)])

            with patch('classification.inference.requests.post', side_effect=fake_model_scoring(72)) as model_call:
                summary = evaluate(dataset_path)

            self.assertEqual(model_call.call_count, 2)
            sent_text = model_call.call_args.kwargs['json']['messages'][1]['content'][0]['text']
            self.assertIn('Replying to this post: We just shipped version 2', sent_text)
            self.assertEqual(Post.objects.count(), 0)
            self.assertEqual(Classification.objects.count(), 0)

            results_paths = list((Path(directory) / 'results').glob('*.json'))
            self.assertEqual(len(results_paths), 1)
            results = json.loads(results_paths[0].read_text())
            self.assertEqual({record['score'] for record in results['results']}, {72})
            # Both scored 72: "a" is caught and "b" is wrongly flagged.
            self.assertIn('clear cases precision  0.50  recall  1.00', summary)
            self.assertIn('wrong clear answers: 1 (0 missed, 1 wrongly flagged)', summary)

    def test_rerun_skips_scored_examples_and_retries_failed_ones(self):
        def invalid_answer_for_example_a(url, **request):
            if 'Text:\nexample a' in request['json']['messages'][1]['content'][0]['text']:
                return model_response('not json')
            return fake_model_scoring(10)(url, **request)

        with tempfile.TemporaryDirectory() as directory:
            dataset_path = write_dataset(directory, [
                labeled_example('a', True, text='example a'),
                labeled_example('b', False, text='example b'),
            ])
            with patch('classification.inference.requests.post', side_effect=invalid_answer_for_example_a):
                summary = evaluate(dataset_path)
            self.assertIn('failed or invalid: 1 of 2', summary)

            with patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)) as model_call:
                summary = evaluate(dataset_path)

            self.assertEqual(model_call.call_count, 1)
            self.assertIn('failed or invalid: 0 of 2', summary)


class ExportFeedbackExamplesTests(TestCase):
    def test_allow_reports_become_negative_examples_once(self):
        user, _ = create_user_with_token('reader@example.com')
        store_post(seen_post('p1', text='Our club meets on Tuesday.'))
        Feedback.objects.create(user=user, source='extension', site_commit='abc', platform='reddit',
                                post_id='p1', shown_action='hide', expected_action='allow')
        Feedback.objects.create(user=user, source='extension', site_commit='abc', platform='reddit',
                                post_id='never-stored', shown_action='allow', expected_action='hide')

        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / 'feedback.jsonl'
            call_command('export_feedback_examples', output=str(output_path), stdout=io.StringIO())
            call_command('export_feedback_examples', output=str(output_path), stdout=io.StringIO())

            examples = [json.loads(line) for line in output_path.read_text().splitlines()]
        self.assertEqual(len(examples), 1)
        self.assertEqual(examples[0]['source'], 'feedback')
        self.assertEqual(examples[0]['text'], 'Our club meets on Tuesday.')
        self.assertEqual(set(examples[0]['expected']), {'brainrot', 'rude-or-toxic', 'low-effort'})
        self.assertFalse(examples[0]['expected']['rude-or-toxic']['flag'])


def filter_result(plugin_slug, flagged):
    return {'plugin': plugin_slug, 'version': 1, 'classification_id': None, 'status': 'done',
            'score': 70 if flagged else 0, 'label': '', 'threshold': 60, 'flagged_action': 'hide', 'flagged': flagged}


class ExportJudgmentExamplesTests(TestCase):
    def export(self):
        with tempfile.TemporaryDirectory() as directory:
            output_path = Path(directory) / 'judgments.jsonl'
            call_command('export_judgment_examples', output=str(output_path), stdout=io.StringIO())
            return {example['text']: example for example in map(json.loads, output_path.read_text().splitlines())}

    def judge(self, user, post_id, verdict, shown_action, filter_results, plugin=None, severity=''):
        post = store_post(seen_post(post_id, text=post_id))
        PostJudgment.objects.create(user=user, post=post, verdict=verdict, shown_action=shown_action,
                                    filter_results=filter_results, plugin=plugin, severity=severity)

    def test_each_verdict_says_what_the_filters_should_have_decided(self):
        user, _ = create_user_with_token('reader@example.com')
        both_on = [filter_result('rude-or-toxic', True), filter_result('low-effort', False)]
        none_flagged = [filter_result('rude-or-toxic', False), filter_result('low-effort', False)]
        self.judge(user, 'rightly-hidden', 'right', 'hide', both_on)
        self.judge(user, 'wrongly-hidden', 'wrong', 'hide', both_on, severity='low')
        self.judge(user, 'rightly-shown', 'right', 'allow', none_flagged)
        self.judge(user, 'missed', 'wrong', 'allow', none_flagged, plugin=Plugin.objects.get(slug='low-effort'))
        self.judge(user, 'missed-no-filter-named', 'wrong', 'allow', none_flagged)

        examples = self.export()

        self.assertEqual(set(examples), {'rightly-hidden', 'wrongly-hidden', 'rightly-shown', 'missed'})
        self.assertEqual(examples['rightly-hidden']['expected']['rude-or-toxic']['flag'], True)
        self.assertNotIn('low-effort', examples['rightly-hidden']['expected'])
        self.assertEqual(examples['wrongly-hidden']['expected']['rude-or-toxic'],
                         {'flag': False, 'difficulty': 'borderline',
                          'why': "Reader's thumbs down on a post that was hide."})
        self.assertEqual({slug: answer['flag'] for slug, answer in examples['rightly-shown']['expected'].items()},
                         {'rude-or-toxic': False, 'low-effort': False})
        self.assertEqual({slug: answer['flag'] for slug, answer in examples['missed']['expected'].items()},
                         {'low-effort': True})
        self.assertEqual(examples['missed']['source'], 'judgment')

    def test_prints_each_filters_test_cases_by_verdict_and_expected_answer(self):
        user, _ = create_user_with_token('reader@example.com')
        both_on = [filter_result('rude-or-toxic', True), filter_result('low-effort', False)]
        none_flagged = [filter_result('rude-or-toxic', False), filter_result('low-effort', False)]
        self.judge(user, 'rightly-hidden', 'right', 'hide', both_on)
        self.judge(user, 'wrongly-hidden', 'wrong', 'hide', both_on)
        self.judge(user, 'rightly-shown', 'right', 'allow', none_flagged)
        self.judge(user, 'missed', 'wrong', 'allow', none_flagged, plugin=Plugin.objects.get(slug='low-effort'))

        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            call_command('export_judgment_examples', output=str(Path(directory) / 'judgments.jsonl'), stdout=output)

        self.assertIn('  low-effort: 2 cases; 1 thumbs up, 1 thumbs down; 1 should flag, 1 should not flag',
                      output.getvalue())
        self.assertIn('  rude-or-toxic: 3 cases; 2 thumbs up, 1 thumbs down; 1 should flag, 2 should not flag',
                      output.getvalue())

    def test_a_thumbs_from_a_deleted_account_is_still_a_test_case(self):
        user, _ = create_user_with_token('reader@example.com')
        self.judge(user, 'rightly-hidden', 'right', 'hide', [filter_result('rude-or-toxic', True)])
        user.delete()

        self.assertEqual(set(self.export()), {'rightly-hidden'})


@override_settings(OPENROUTER_API_KEY='test-key')
class CriteriaEvaluationTests(TestCase):
    def test_summary_counts_each_criterion_on_expected_flagged_and_allowed_examples(self):
        def contempt_for_example_a(url, **request):
            schema = request['json']['response_format']['json_schema']['schema']
            is_a = 'Text:\nexample a' in request['json']['messages'][1]['content'][0]['text']
            answer = {'reasoning': 'A reply.'}
            for name in schema['properties']:
                if name != 'reasoning':
                    answer[name] = is_a and name in ('demeans_people', 'us_against_them')
            return model_response(answer)

        examples = []
        for example_id, flag in [('a', True), ('b', False)]:
            example = labeled_example(example_id, flag, text=f'example {example_id}')
            example['expected'] = {'rude-or-toxic': {'flag': flag, 'difficulty': 'clear', 'why': 'test'}}
            examples.append(example)
        with tempfile.TemporaryDirectory() as directory:
            with patch('classification.inference.requests.post', side_effect=contempt_for_example_a):
                summary = evaluate(write_dataset(directory, examples))

        self.assertIn('demeans_people (50): 1 of 1, 0 of 1', summary)
        self.assertIn('plainly_a_joke (-50): 0 of 1, 0 of 1', summary)
        self.assertIn('clear cases precision  1.00  recall  1.00', summary)
