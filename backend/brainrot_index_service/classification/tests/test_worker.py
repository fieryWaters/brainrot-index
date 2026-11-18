import base64
import io
import tempfile
from unittest.mock import MagicMock, patch

import requests
from django.test import TestCase, override_settings
from PIL import Image

from classification.models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_FAILED,
    IMAGE_DOWNLOADED,
    IMAGE_PENDING,
    Classification,
    Plugin,
    PostImage,
)
from classification.views import store_post
from classification.worker import classify_next_pending, download_next_pending_image

from .helpers import fake_model_scoring, model_response, seen_post


def png_bytes(width, height):
    buffer = io.BytesIO()
    Image.new('RGB', (width, height), 'green').save(buffer, format='PNG')
    return buffer.getvalue()


def image_download_response(image_bytes):
    response = MagicMock()
    response.__enter__.return_value = response
    response.status_code = 200
    response.headers = {'Content-Type': 'image/png'}
    response.iter_content.return_value = [image_bytes]
    return response


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(), INFERENCE_SOURCE='openrouter', OPENROUTER_MODEL='test/model')
class WorkerTests(TestCase):
    def queue(self, post_data, plugin_slug='ragebait'):
        post = store_post(post_data)
        plugin_version = Plugin.objects.get(slug=plugin_slug).latest_version()
        return Classification.objects.create(post=post, plugin_version=plugin_version)

    def test_valid_answer_is_saved(self):
        classification = self.queue(seen_post('p1'))

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(72)) as model_call:
            self.assertTrue(classify_next_pending())

        classification.refresh_from_db()
        self.assertEqual(classification.status, CLASSIFICATION_DONE)
        self.assertEqual(classification.score, 72)
        self.assertEqual(classification.label, 'not_ragebait')
        self.assertIn('garden photo', classification.reasoning)
        self.assertEqual(classification.model, 'test/model')
        self.assertEqual(classification.inference_source, 'openrouter')
        self.assertEqual(classification.prompt_tokens, 900)
        self.assertEqual(classification.completion_tokens, 60)
        self.assertIsNotNone(classification.latency_ms)
        self.assertIsNotNone(classification.completed_at)

        request = model_call.call_args.kwargs['json']
        self.assertEqual(request['provider'], {'require_parameters': True})
        self.assertEqual(request['response_format']['type'], 'json_schema')
        self.assertTrue(request['messages'][0]['content'].startswith(classification.plugin_version.rubric_prompt))
        self.assertIn('A photo of my garden', request['messages'][1]['content'][0]['text'])
        self.assertEqual(classification.prompt, request['messages'])
        self.assertFalse(classify_next_pending())

    def test_invalid_answer_is_retried_once(self):
        classification = self.queue(seen_post('p1'))
        answers = [
            model_response('not json'),
            model_response({'reasoning': 'Sober report.', 'score': 20, 'label': 'not_ragebait'}),
        ]

        with patch('classification.inference.requests.post', side_effect=answers) as model_call:
            classify_next_pending()

        classification.refresh_from_db()
        self.assertEqual(model_call.call_count, 2)
        self.assertEqual(classification.status, CLASSIFICATION_DONE)
        self.assertEqual(classification.score, 20)

    def test_two_invalid_answers_mark_it_failed(self):
        classification = self.queue(seen_post('p1'))
        bad_answers = [
            model_response({'reasoning': 'x', 'score': 50, 'label': 'not_a_label'}),
            model_response({'reasoning': 'x', 'score': 150, 'label': 'not_ragebait'}),
        ]

        with patch('classification.inference.requests.post', side_effect=bad_answers) as model_call:
            classify_next_pending()

        classification.refresh_from_db()
        self.assertEqual(model_call.call_count, 2)
        self.assertEqual(classification.status, CLASSIFICATION_FAILED)
        self.assertIsNone(classification.score)

    def test_criteria_answers_are_scored_in_code(self):
        classification = self.queue(seen_post('p1'), plugin_slug='rude-or-toxic')
        answer = {
            'reasoning': 'A reply calling everyone on the other side idiots.',
            'demeans_people': True,
            'us_against_them': True,
            'hostile_tone': False,
            'plainly_a_joke': False,
        }

        with patch('classification.inference.requests.post', return_value=model_response(answer)) as model_call:
            classify_next_pending()

        classification.refresh_from_db()
        self.assertEqual(classification.status, CLASSIFICATION_DONE)
        self.assertEqual(classification.score, 80)
        self.assertEqual(classification.label, 'demeans_people')
        self.assertEqual(classification.criteria_met, ['demeans_people', 'us_against_them'])

        request = model_call.call_args.kwargs['json']
        schema = request['response_format']['json_schema']['schema']
        self.assertEqual(schema['required'], [
            'reasoning', 'demeans_people', 'us_against_them', 'hostile_tone', 'plainly_a_joke'])
        system_prompt = request['messages'][0]['content']
        for criterion in classification.plugin_version.criteria:
            self.assertIn(f"- {criterion['name']}: {criterion['question']}", system_prompt)
        # The model judges the criteria; it is never shown what they are worth.
        self.assertNotIn('points', system_prompt)

    def test_criteria_answer_missing_a_criterion_is_invalid(self):
        classification = self.queue(seen_post('p1'), plugin_slug='rude-or-toxic')
        incomplete = model_response(
            {'reasoning': 'x', 'demeans_people': True, 'us_against_them': False})

        with patch('classification.inference.requests.post', return_value=incomplete):
            classify_next_pending()

        classification.refresh_from_db()
        self.assertEqual(classification.status, CLASSIFICATION_FAILED)

    def test_a_virtue_takes_points_off_and_the_score_stays_at_or_above_0(self):
        classification = self.queue(seen_post('p1'), plugin_slug='rude-or-toxic')
        answer = {
            'reasoning': 'A crude joke at a fictional person.',
            'demeans_people': True,
            'us_against_them': False,
            'hostile_tone': False,
            'plainly_a_joke': True,
        }

        with patch('classification.inference.requests.post', return_value=model_response(answer)):
            classify_next_pending()

        classification.refresh_from_db()
        self.assertEqual(classification.score, 0)
        self.assertEqual(classification.label, 'demeans_people')
        self.assertEqual(classification.criteria_met, ['demeans_people', 'plainly_a_joke'])

    def test_no_criterion_met_scores_0_with_label_none(self):
        classification = self.queue(seen_post('p1'), plugin_slug='rude-or-toxic')
        answer = {
            'reasoning': 'A garden photo.',
            'demeans_people': False,
            'us_against_them': False,
            'hostile_tone': False,
            'plainly_a_joke': False,
        }

        with patch('classification.inference.requests.post', return_value=model_response(answer)):
            classify_next_pending()

        classification.refresh_from_db()
        self.assertEqual(classification.score, 0)
        self.assertEqual(classification.label, 'none')
        self.assertEqual(classification.criteria_met, [])

    def test_classification_uses_a_small_rendition_without_waiting_for_the_archive(self):
        x_photo_url = 'https://pbs.twimg.com/media/garden?format=png&name=orig'
        classification = self.queue(seen_post('p1', platform='x', image_urls=[x_photo_url]))

        with (
            patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)) as model_call,
            patch('classification.images.requests.get', return_value=image_download_response(png_bytes(680, 340))) as fetch,
        ):
            self.assertTrue(classify_next_pending())

        self.assertEqual(fetch.call_args.args[0], 'https://pbs.twimg.com/media/garden?format=png&name=small')
        sent_image_url = model_call.call_args.kwargs['json']['messages'][1]['content'][1]['image_url']['url']
        self.assertTrue(sent_image_url.startswith('data:image/jpeg;base64,'))
        classification.refresh_from_db()
        self.assertEqual(classification.status, CLASSIFICATION_DONE)
        # The original is archived afterwards, at the URL the extension sent.
        self.assertEqual(PostImage.objects.get(post=classification.post).status, IMAGE_PENDING)
        with patch('classification.images.requests.get', return_value=image_download_response(png_bytes(2000, 1000))) as fetch:
            self.assertTrue(download_next_pending_image())
        self.assertEqual(fetch.call_args.args[0], x_photo_url)
        self.assertEqual(PostImage.objects.get(post=classification.post).status, IMAGE_DOWNLOADED)

    def test_archived_images_are_sent_downscaled(self):
        classification = self.queue(seen_post('p1', image_urls=['https://i.redd.it/garden.png']))

        with patch('classification.images.requests.get', return_value=image_download_response(png_bytes(2000, 1000))):
            self.assertTrue(download_next_pending_image())
        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)) as model_call:
            self.assertTrue(classify_next_pending())

        post_image = PostImage.objects.get(post=classification.post)
        self.assertEqual(post_image.status, IMAGE_DOWNLOADED)
        self.assertEqual(post_image.byte_size, len(png_bytes(2000, 1000)))
        self.assertTrue(post_image.file.name.endswith('.png'))

        sent_image_url = model_call.call_args.kwargs['json']['messages'][1]['content'][1]['image_url']['url']
        self.assertTrue(sent_image_url.startswith('data:image/jpeg;base64,'))
        sent_image = Image.open(io.BytesIO(base64.b64decode(sent_image_url.split(',', 1)[1])))
        self.assertEqual(sent_image.size, (768, 384))

        classification.refresh_from_db()
        stored_image_part = classification.prompt[1]['content'][1]
        self.assertEqual(stored_image_part['image_url']['url'], f'post_image:{post_image.id}')

    def test_reply_prompt_includes_the_stored_parent_post(self):
        store_post(seen_post('p1', text='We just shipped version 2 of our compiler.'))
        classification = self.queue(seen_post('t1', kind='reply', parent_post_id='p1', text='Great point!'))

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(10)):
            classify_next_pending()

        classification.refresh_from_db()
        post_description = classification.prompt[1]['content'][0]['text']
        self.assertIn('Kind: reply', post_description)
        self.assertIn('We just shipped version 2', post_description)

    def test_model_http_error_counts_as_an_invalid_answer(self):
        classification = self.queue(seen_post('p1'))
        with patch('classification.inference.requests.post', side_effect=requests.ConnectionError('down')):
            classify_next_pending()
        classification.refresh_from_db()
        self.assertEqual(classification.status, CLASSIFICATION_FAILED)
