import io
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings

from classification.models import Classification, Post
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
        self.assertEqual(set(examples[0]['expected']), {'engagement-bait', 'ragebait', 'brainrot', 'ai-slop'})
        self.assertFalse(examples[0]['expected']['ragebait']['flag'])
