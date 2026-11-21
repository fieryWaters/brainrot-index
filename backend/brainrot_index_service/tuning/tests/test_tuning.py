import json
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from api.sign_in import SIGN_IN_GOOGLE, SIGN_IN_PASSWORD
from classification.inference import system_prompt
from classification.models import Plugin, PluginVersion, Post, PostJudgment
from classification.tests.helpers import create_verified_user, model_response
from feedback.tests.test_inbox import signed_in_client
from tuning.models import EXPERIMENT_DONE, EXPERIMENT_PENDING, EXPERIMENT_RUNNING, TuningExperiment, TuningResult
from tuning.runs import post_as_read, run_next_tuning_experiment

OWNER_EMAIL = 'owner@example.com'
LIVE_RUBRIC = 'Judge shouting.'
DRAFT_RUBRIC = 'Judge shouting, but only at people.'
CRITERIA = [
    {'name': 'caps', 'question': 'Is it written in capitals?', 'points': 60},
    {'name': 'insult', 'question': 'Does it insult someone?', 'points': 40},
]


def flagged_by_shouting():
    return [{
        'plugin': 'shouting', 'version': 1, 'threshold': 50, 'flagged_action': 'hide', 'classification_id': None,
        'status': 'done', 'score': 60, 'label': 'caps', 'flagged': True,
    }]


def fake_model(requests_sent):
    """The live rubric finds capitals in every post; the draft only in posts
    that shout at someone. An explanation request gets one line per criterion."""
    def answer(url, **request):
        body = request['json']
        requests_sent.append(body)
        schema = body['response_format']['json_schema']['schema']
        if body['response_format']['json_schema']['name'] == 'explanations':
            return model_response({name: f"Why {name}." for name in schema['properties']})
        post_text = body['messages'][1]['content'][0]['text']
        if body['messages'][0]['content'].startswith(DRAFT_RUBRIC):
            caps = 'YOU' in post_text
        else:
            caps = True
        return model_response({'reasoning': 'A post in capitals.', 'caps': caps, 'insult': False})
    return answer


def write_dataset(directory, examples):
    dataset_path = Path(directory) / 'dataset.jsonl'
    dataset_path.write_text(''.join(json.dumps(example) + '\n' for example in examples))
    return dataset_path


@override_settings(LOCAL_AUTH_BYPASS=False, ADMIN_EMAIL=OWNER_EMAIL, OPENROUTER_API_KEY='test-key',
                   INFERENCE_SOURCE='openrouter', OPENROUTER_MODEL='test/model',
                   TUNING_SYNTHETIC_DATASET='/nonexistent/dataset.jsonl')
class TuningTests(TestCase):
    def setUp(self):
        self.owner = create_verified_user(OWNER_EMAIL)
        self.owner_client = signed_in_client(self.owner, SIGN_IN_GOOGLE)
        self.reader = create_verified_user('reader@example.com')

        self.plugin = Plugin.objects.create(slug='shouting', name='Shouting', description='All caps posts.',
                                            is_baseline=True, default_threshold=50)
        PluginVersion.objects.create(plugin=self.plugin, version=1, rubric_prompt=LIVE_RUBRIC,
                                     allowed_labels=['none', 'caps', 'insult'], criteria=CRITERIA)
        loud_post = Post.objects.create(platform='x', post_id='1', kind='post', url='https://x.com/a/status/1',
                                        text='GOOD MORNING EVERYONE')
        rude_post = Post.objects.create(platform='x', post_id='2', kind='post', url='https://x.com/a/status/2',
                                        text='YOU ARE ALL WRONG')
        # Hidden, and the owner says it should not have been.
        self.loud_thumb = PostJudgment.objects.create(
            user=self.owner, post=loud_post, verdict='wrong', shown_action='hide', plugin=self.plugin,
            details='Just cheerful.', filter_results=flagged_by_shouting())
        # Hidden, and the owner says rightly.
        self.rude_thumb = PostJudgment.objects.create(
            user=self.owner, post=rude_post, verdict='right', shown_action='hide', plugin=self.plugin,
            filter_results=flagged_by_shouting())
        # Another reader's thumbs is not the owner's labeled set.
        self.reader_thumb = PostJudgment.objects.create(
            user=self.reader, post=loud_post, verdict='right', shown_action='hide', plugin=self.plugin,
            filter_results=flagged_by_shouting())

    def draft(self, **overrides):
        draft = {'plugin': 'shouting', 'rubric_prompt': DRAFT_RUBRIC, 'criteria': CRITERIA, 'threshold': 50}
        draft.update(overrides)
        return draft

    def start_experiment(self, **overrides):
        response = self.owner_client.post(reverse('tuning_experiments'), self.draft(**overrides),
                                          content_type='application/json')
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def run_worker(self):
        requests_sent = []
        with patch('requests.post', side_effect=fake_model(requests_sent)):
            while run_next_tuning_experiment():
                pass
        return requests_sent

    def test_everyone_but_the_owner_signed_in_with_google_is_refused(self):
        experiment = TuningExperiment.objects.create(
            plugin=self.plugin, live_version=self.plugin.latest_version(), live_threshold=50,
            rubric_prompt=DRAFT_RUBRIC, criteria=CRITERIA, threshold=50, model='test/model',
            inference_source='openrouter')
        refused_clients = [
            Client(),
            signed_in_client(self.reader, SIGN_IN_GOOGLE),
            signed_in_client(self.owner, SIGN_IN_PASSWORD),
        ]
        for client in refused_clients:
            self.assertIn(client.get(reverse('tuning_filters')).status_code, [401, 403])
            self.assertIn(client.get(reverse('tuning_experiments')).status_code, [401, 403])
            started = client.post(reverse('tuning_experiments'), self.draft(), content_type='application/json')
            self.assertIn(started.status_code, [401, 403])
            self.assertIn(client.get(reverse('tuning_experiment', args=[experiment.id])).status_code, [401, 403])
            changed = client.patch(reverse('tuning_thumb', args=[self.loud_thumb.id]), {'verdict': 'right'},
                                   content_type='application/json')
            self.assertIn(changed.status_code, [401, 403])
            self.assertIn(client.delete(reverse('tuning_thumb', args=[self.loud_thumb.id])).status_code, [401, 403])
        self.assertEqual(TuningExperiment.objects.count(), 1)
        self.assertTrue(PostJudgment.objects.filter(id=self.loud_thumb.id, verdict='wrong').exists())

    def test_filters_list_the_live_rubric_and_the_owners_thumbs_for_it(self):
        response = self.owner_client.get(reverse('tuning_filters'))
        self.assertEqual(response.status_code, 200)
        shouting = next(found for found in response.json()['filters'] if found['slug'] == 'shouting')
        self.assertEqual(shouting['live'], {'version': 1, 'rubric_prompt': LIVE_RUBRIC, 'criteria': CRITERIA, 'threshold': 50})
        self.assertEqual(shouting['thumb_cases'], 2)
        self.assertEqual(shouting['synthetic_cases'], 0)
        self.assertEqual(response.json()['model'], 'test/model')

    def test_a_draft_runs_on_the_owners_thumbs_beside_the_live_version(self):
        started = self.start_experiment()
        self.assertEqual(started['status'], EXPERIMENT_PENDING)
        requests_sent = self.run_worker()

        # Two thumbs, each judged by the draft and the live version, and one explanation.
        self.assertEqual(len(requests_sent), 5)
        experiment = TuningExperiment.objects.get(id=started['id'])
        draft_version = experiment.draft_version()
        classification_requests = [body for body in requests_sent if body['response_format']['json_schema']['name'] == 'classification']
        # The production prompt, unchanged: the explanation is asked for afterwards.
        self.assertEqual(classification_requests[0]['messages'][0]['content'][:len(DRAFT_RUBRIC)], DRAFT_RUBRIC)
        draft_prompts = {body['messages'][0]['content'] for body in classification_requests
                         if body['messages'][0]['content'].startswith(DRAFT_RUBRIC)}
        self.assertEqual(draft_prompts, {system_prompt(draft_version)})

        response = self.owner_client.get(reverse('tuning_experiment', args=[started['id']]))
        self.assertEqual(response.status_code, 200)
        shown = response.json()
        self.assertEqual(shown['status'], EXPERIMENT_DONE)
        self.assertEqual(shown['scores']['thumb'], {
            'cases': 2,
            'draft': {'right': 2, 'missed': 0, 'wrongly_flagged': 0, 'failed': 0},
            'live': {'right': 1, 'missed': 0, 'wrongly_flagged': 1, 'failed': 0},
        })
        self.assertNotIn('synthetic', shown['scores'])
        self.assertEqual(shown['prompt_tokens'], 5 * 900)
        self.assertEqual(shown['completion_tokens'], 5 * 60)

        results = {result['case_id']: result for result in shown['results']}
        loud = results[f"judgment-{self.loud_thumb.id}"]
        self.assertFalse(loud['should_flag'])
        self.assertEqual(loud['owner'], {'verdict': 'wrong', 'shown_action': 'hide', 'plugin': 'shouting',
                                         'details': 'Just cheerful.'})
        self.assertEqual(loud['post'], {
            'platform': 'x', 'kind': 'post', 'author': '', 'community': '', 'text': 'GOOD MORNING EVERYONE',
            'quoted_post': {}, 'link_preview': {}, 'parent_text': None, 'parent_is_reply': False, 'thread_text': None,
        })
        self.assertEqual(loud['draft']['score'], 0)
        self.assertEqual(loud['live']['score'], 60)
        # The draft decided differently from the live version, so it was explained.
        self.assertEqual(loud['explanations'], {'caps': 'Why caps.', 'insult': 'Why insult.'})
        rude = results[f"judgment-{self.rude_thumb.id}"]
        self.assertEqual(rude['draft']['criteria_met'], ['caps'])
        self.assertEqual(rude['explanations'], {})

        # The explanation follows the draft's own answer, in the same conversation.
        explanation_request = next(body for body in requests_sent if body['response_format']['json_schema']['name'] == 'explanations')
        self.assertEqual(explanation_request['messages'][0]['content'], system_prompt(draft_version))
        self.assertEqual(json.loads(explanation_request['messages'][2]['content']),
                         {'reasoning': 'A post in capitals.', 'caps': False, 'insult': False})

    def test_a_later_experiment_reuses_the_live_versions_answers(self):
        self.start_experiment()
        self.run_worker()
        second = self.start_experiment(threshold=70, explain_every_case=True)
        requests_sent = self.run_worker()

        # Two draft answers and two explanations; the live answers are the first experiment's.
        self.assertEqual(len(requests_sent), 4)
        results = TuningResult.objects.filter(experiment_id=second['id'])
        self.assertTrue(all(result.live_reused for result in results))
        self.assertEqual(sorted(result.live['score'] for result in results), [60, 60])

    def test_the_synthetic_test_set_is_judged_when_asked_for(self):
        examples = [
            {'id': 'syn-1', 'source': 'synthetic', 'platform': 'x', 'kind': 'post', 'community': '',
             'text': 'YOU NEVER LISTEN', 'expected': {'shouting': {'flag': True, 'difficulty': 'clear', 'why': 'Shouts at someone.'}}},
            {'id': 'syn-2', 'source': 'synthetic', 'platform': 'x', 'kind': 'post', 'community': '',
             'text': 'Hello there', 'expected': {'ragebait': {'flag': False, 'difficulty': 'clear', 'why': 'Calm.'}}},
        ]
        with tempfile.TemporaryDirectory() as directory:
            dataset_path = write_dataset(directory, examples)
            with self.settings(TUNING_SYNTHETIC_DATASET=str(dataset_path)):
                shouting = next(found for found in self.owner_client.get(reverse('tuning_filters')).json()['filters']
                                if found['slug'] == 'shouting')
                self.assertEqual(shouting['synthetic_cases'], 1)
                started = self.start_experiment(include_synthetic=True)
                self.run_worker()

        shown = self.owner_client.get(reverse('tuning_experiment', args=[started['id']])).json()
        self.assertEqual(shown['total_cases'], 3)
        self.assertEqual(shown['scores']['synthetic']['cases'], 1)
        synthetic = next(result for result in shown['results'] if result['case_id'] == 'syn-1')
        self.assertEqual(synthetic['owner'], {'why': 'Shouts at someone.'})
        self.assertEqual((synthetic['post']['text'], synthetic['post']['author']), ('YOU NEVER LISTEN', ''))
        self.assertTrue(synthetic['should_flag'])

    def test_a_reply_is_shown_with_the_posts_it_answers(self):
        Post.objects.create(platform='reddit', post_id='t1', kind='post', author='op', text='What do you think?')
        Post.objects.create(platform='reddit', post_id='c1', kind='reply', parent_post_id='t1', author='first',
                            text='I think yes.')
        reply = Post.objects.create(platform='reddit', post_id='c2', kind='reply', parent_post_id='c1',
                                    author='second', community='r/test', text='NO WAY')
        self.assertEqual(post_as_read(reply), {
            'platform': 'reddit', 'kind': 'reply', 'author': 'second', 'community': 'r/test', 'text': 'NO WAY',
            'quoted_post': {}, 'link_preview': {}, 'parent_text': 'I think yes.', 'parent_is_reply': True,
            'thread_text': 'What do you think?',
        })

    def test_the_synthetic_test_set_is_refused_when_it_has_no_examples_for_the_filter(self):
        response = self.owner_client.post(reverse('tuning_experiments'), self.draft(include_synthetic=True),
                                          content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_a_draft_with_unusable_criteria_is_refused(self):
        unusable = [
            [],
            [{'name': 'Caps Lock', 'question': 'Capitals?', 'points': 60}],
            [{'name': 'caps', 'question': 'Capitals?', 'points': 60}, {'name': 'caps', 'question': 'Again?', 'points': 10}],
            [{'name': 'reasoning', 'question': 'Capitals?', 'points': 60}],
            [{'name': 'caps', 'question': 'Capitals?', 'points': 500}],
        ]
        for criteria in unusable:
            response = self.owner_client.post(reverse('tuning_experiments'), self.draft(criteria=criteria),
                                              content_type='application/json')
            self.assertEqual(response.status_code, 400, criteria)
        self.assertEqual(TuningExperiment.objects.count(), 0)

    def test_a_stalled_run_is_taken_up_again_and_keeps_its_finished_cases(self):
        started = self.start_experiment()
        experiment = TuningExperiment.objects.get(id=started['id'])
        TuningResult.objects.create(
            experiment=experiment, case_id=f"judgment-{self.rude_thumb.id}", source='thumb', description='earlier',
            should_flag=True, draft={'failed': False, 'score': 60, 'criteria_met': ['caps'], 'reasoning': ''},
            live={'failed': False, 'score': 60, 'criteria_met': ['caps'], 'reasoning': ''})
        experiment.status = EXPERIMENT_RUNNING
        experiment.heartbeat_at = timezone.now() - timedelta(minutes=10)
        experiment.save()

        requests_sent = self.run_worker()

        # Only the loud thumbs is judged: draft, live, and an explanation.
        self.assertEqual(len(requests_sent), 3)
        experiment.refresh_from_db()
        self.assertEqual(experiment.status, EXPERIMENT_DONE)
        self.assertEqual(experiment.results.count(), 2)

    def test_the_owner_changes_and_deletes_thumbs(self):
        started = self.start_experiment()
        self.run_worker()

        changed = self.owner_client.patch(reverse('tuning_thumb', args=[self.loud_thumb.id]),
                                          {'verdict': 'right', 'details': 'Loud after all.'}, content_type='application/json')
        self.assertEqual(changed.status_code, 200)
        self.loud_thumb.refresh_from_db()
        self.assertEqual((self.loud_thumb.verdict, self.loud_thumb.details), ('right', 'Loud after all.'))

        refused = self.owner_client.patch(reverse('tuning_thumb', args=[self.loud_thumb.id]), {'verdict': 'maybe'},
                                          content_type='application/json')
        self.assertEqual(refused.status_code, 400)
        # Another reader's thumbs is theirs.
        self.assertEqual(self.owner_client.delete(reverse('tuning_thumb', args=[self.reader_thumb.id])).status_code, 404)

        self.assertEqual(self.owner_client.delete(reverse('tuning_thumb', args=[self.rude_thumb.id])).status_code, 204)
        self.assertFalse(PostJudgment.objects.filter(id=self.rude_thumb.id).exists())
        # The experiment still reads as it ran.
        shown = self.owner_client.get(reverse('tuning_experiment', args=[started['id']])).json()
        rude = next(result for result in shown['results'] if result['case_id'] == f"judgment-{self.rude_thumb.id}")
        self.assertIsNone(rude['judgment_id'])
        self.assertEqual(rude['owner']['verdict'], 'right')

    def test_past_experiments_are_listed_newest_first(self):
        first = self.start_experiment()
        second = self.start_experiment(threshold=70, started_from=first['id'])
        self.run_worker()

        listed = self.owner_client.get(reverse('tuning_experiments'), {'plugin': 'shouting'}).json()['experiments']
        self.assertEqual([experiment['id'] for experiment in listed], [second['id'], first['id']])
        self.assertEqual(listed[0]['started_from'], first['id'])
        self.assertEqual(listed[0]['scores']['thumb']['cases'], 2)
        self.assertEqual(self.owner_client.get(reverse('tuning_experiments'), {'plugin': 'other'}).json()['experiments'], [])
