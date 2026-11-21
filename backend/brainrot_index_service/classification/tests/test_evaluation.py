import io
import json
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings

from classification.inference import system_prompt
from classification.models import Classification, Plugin, PostJudgment
from classification.scoring import answer_schema
from classification.views import store_post

from .helpers import create_verified_user, fake_model_scoring, model_response, seen_post

OWNER_EMAIL = 'owner@example.com'


def judge(user, post_id, should_be, plugin_slug=None, text=None):
    """A thumbs on a new post: should_be 'shown', or 'blocked' as plugin_slug."""
    post = store_post(seen_post(post_id, text=text or post_id))
    plugin = Plugin.objects.get(slug=plugin_slug) if plugin_slug else None
    PostJudgment.objects.create(user=user, post=post, verdict='right', shown_action='allow',
                                should_be=should_be, plugin=plugin, filter_results=[])


def evaluate(**options):
    output = io.StringIO()
    call_command('evaluate_plugins', inference_source='openrouter', model='test/model', stdout=output, **options)
    return output.getvalue()


@override_settings(OPENROUTER_API_KEY='test-key', ADMIN_EMAIL=OWNER_EMAIL)
class EvaluatePluginsTests(TestCase):
    def setUp(self):
        self.owner = create_verified_user(OWNER_EMAIL)

    def test_scores_the_owners_thumbs_without_touching_classifications(self):
        judge(self.owner, 'a', 'blocked', 'ragebait', text='example a')
        judge(self.owner, 'b', 'shown', text='example b')
        judge(create_verified_user('reader@example.com'), 'c', 'shown', text='example c')

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(72)) as model_call:
            summary = evaluate(plugin='ragebait')

        # Only the owner's thumbs are cases.
        self.assertEqual(model_call.call_count, 2)
        sent_texts = [call.kwargs['json']['messages'][1]['content'][0]['text'] for call in model_call.call_args_list]
        self.assertTrue(any('Text:\nexample a' in text for text in sent_texts))
        self.assertEqual(Classification.objects.count(), 0)
        # Both scored 72: "a" is caught and "b" is wrongly flagged.
        self.assertIn('clear cases precision  0.50  recall  1.00', summary)
        self.assertIn('wrong clear answers: 1 (0 missed, 1 wrongly flagged)', summary)

    def test_without_a_plugin_every_default_filter_and_every_filter_a_thumbs_names_is_scored(self):
        judge(self.owner, 'a', 'blocked', 'ragebait')
        judge(self.owner, 'b', 'shown')

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)):
            summary = evaluate()

        self.assertIn('== ragebait', summary)
        self.assertIn('== low-effort', summary)
        # Blocked as ragebait says nothing about low-effort.
        low_effort_heading = next(line for line in summary.splitlines() if line.startswith('== low-effort'))
        self.assertIn('1 examples, 0 expected flagged', low_effort_heading)

    def test_summary_counts_each_criterion_on_expected_flagged_and_allowed_examples(self):
        def contempt_for_example_a(url, **request):
            schema = request['json']['response_format']['json_schema']['schema']
            is_a = 'Text:\nexample a' in request['json']['messages'][1]['content'][0]['text']
            answer = {'reasoning': 'A reply.'}
            for name in schema['properties']:
                if name != 'reasoning':
                    answer[name] = is_a and name in ('delivers_hostility', 'contempt_for_people')
            return model_response(answer)

        judge(self.owner, 'a', 'blocked', 'rude-or-toxic', text='example a')
        judge(self.owner, 'b', 'shown', text='example b')
        with patch('classification.inference.requests.post', side_effect=contempt_for_example_a):
            summary = evaluate(plugin='rude-or-toxic')

        self.assertIn('delivers_hostility (50): 1 of 1, 0 of 1', summary)
        self.assertIn('makes_readers_laugh (-50): 0 of 1, 0 of 1', summary)
        self.assertIn('clear cases precision  1.00  recall  1.00', summary)

    def test_explain_prints_why_each_criterion_was_judged(self):
        requests_sent = []

        def contempt_explained(url, **request):
            requests_sent.append(request['json'])
            schema = request['json']['response_format']['json_schema']['schema']
            answer = {'reasoning': 'A reply.'}
            for name in schema['properties']:
                if name.startswith('why_'):
                    answer[name] = f"Explanation of {name[len('why_'):]}."
                elif name != 'reasoning':
                    answer[name] = name == 'delivers_hostility'
            return model_response(answer)

        # Scored 50, below the default threshold, so it is a miss whose explanations are printed.
        judge(self.owner, 'a', 'blocked', 'rude-or-toxic', text='example a')
        with patch('classification.inference.requests.post', side_effect=contempt_explained):
            summary = evaluate(plugin='rude-or-toxic', explain=True)

        self.assertIn('scored 50', summary)
        self.assertIn('    makes_readers_laugh: Explanation of makes_readers_laugh.', summary)
        self.assertIn('why_', requests_sent[0]['messages'][0]['content'])

        plugin_version = Plugin.objects.get(slug='rude-or-toxic').latest_version()
        self.assertNotIn('why_', json.dumps(answer_schema(plugin_version)))
        self.assertNotIn('why_', system_prompt(plugin_version))
