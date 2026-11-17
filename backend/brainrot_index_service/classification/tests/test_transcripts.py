from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from youtube_transcript_api import FetchedTranscript, FetchedTranscriptSnippet, TranscriptsDisabled

from classification.models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_PENDING,
    TRANSCRIPT_FETCHED,
    TRANSCRIPT_MISSING,
    TRANSCRIPT_PENDING,
    TRANSCRIPT_SOURCE_SERVER,
    Classification,
    Plugin,
    VideoTranscript,
)
from classification.transcripts import SessionWithTimeout
from classification.views import store_post
from classification.worker import classify_next_pending, download_next_pending_transcript, settle_next_transcripts

from .helpers import bearer, create_user_with_token, fake_model_scoring, seen_post


def seen_video(video_id, title='How I cook pasta on weeknights', **overrides):
    video = seen_post(
        video_id,
        text=title,
        platform='youtube',
        url=f'https://www.youtube.com/watch?v={video_id}',
        author='A Cooking Channel',
        community='',
        image_urls=[],
    )
    video.update(overrides)
    return video


def fetched_transcript(video_id, sentences):
    return FetchedTranscript(
        snippets=[FetchedTranscriptSnippet(text=sentence, start=index * 2.0, duration=2.0)
                  for index, sentence in enumerate(sentences)],
        video_id=video_id,
        language='English (auto-generated)',
        language_code='en',
        is_generated=True,
    )


@override_settings(INFERENCE_SOURCE='openrouter', OPENROUTER_MODEL='test/model', YOUTUBE_SERVER_TRANSCRIPTS=True)
class TranscriptTests(TestCase):
    def queue(self, post_data):
        post = store_post(post_data)
        plugin_version = Plugin.objects.get(slug='ragebait').latest_version()
        return Classification.objects.create(post=post, plugin_version=plugin_version)

    def user_message(self, classification):
        return classification.prompt[1]['content'][0]['text']

    def test_a_video_gets_a_pending_transcript_and_other_posts_none(self):
        video = store_post(seen_video('vid00000001', image_urls=['https://i.ytimg.com/vi/vid00000001/hqdefault.jpg']))
        reddit_post = store_post(seen_post('p1'))

        self.assertEqual(video.transcript.status, TRANSCRIPT_PENDING)
        self.assertEqual(video.image_urls, ['https://i.ytimg.com/vi/vid00000001/hqdefault.jpg'])
        self.assertFalse(VideoTranscript.objects.filter(post=reddit_post).exists())

    def test_a_video_is_classified_only_after_its_transcript_is_fetched(self):
        classification = self.queue(seen_video('vid00000001'))

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(30)):
            self.assertFalse(classify_next_pending())
        classification.refresh_from_db()
        self.assertEqual(classification.status, CLASSIFICATION_PENDING)

        transcript = fetched_transcript('vid00000001', ['Today we boil water.', 'Then the pasta goes in.'])
        with patch('classification.transcripts.fetch_transcript', return_value=transcript) as fetch:
            self.assertTrue(download_next_pending_transcript())
        fetch.assert_called_once_with('vid00000001')
        self.assertFalse(download_next_pending_transcript())

        video_transcript = VideoTranscript.objects.get(post__post_id='vid00000001')
        self.assertEqual(video_transcript.status, TRANSCRIPT_FETCHED)
        self.assertEqual(video_transcript.language_code, 'en')
        self.assertTrue(video_transcript.is_generated)
        self.assertEqual(video_transcript.snippets[1], {'text': 'Then the pasta goes in.', 'start': 2.0, 'duration': 2.0})
        self.assertIsNotNone(video_transcript.fetched_at)

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(30)):
            self.assertTrue(classify_next_pending())
        classification.refresh_from_db()
        self.assertEqual(classification.status, CLASSIFICATION_DONE)
        message = self.user_message(classification)
        self.assertIn('Platform: YouTube', message)
        self.assertIn('How I cook pasta on weeknights', message)
        self.assertIn('Transcript:\nToday we boil water. Then the pasta goes in.', message)

    def test_only_the_opening_words_of_a_long_transcript_are_sent(self):
        classification = self.queue(seen_video('vid00000002'))
        transcript = fetched_transcript('vid00000002', [f'word{index}' for index in range(5000)])
        with patch('classification.transcripts.fetch_transcript', return_value=transcript):
            download_next_pending_transcript()

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(30)):
            classify_next_pending()
        classification.refresh_from_db()
        message = self.user_message(classification)
        self.assertIn('word1999 ...', message)
        self.assertNotIn('word2000', message)
        self.assertEqual(len(VideoTranscript.objects.get(post__post_id='vid00000002').snippets), 5000)

    def test_a_video_without_a_transcript_is_classified_on_its_title_and_thumbnail(self):
        classification = self.queue(seen_video('vid00000003'))
        with patch('classification.transcripts.fetch_transcript', side_effect=TranscriptsDisabled('vid00000003')):
            self.assertTrue(download_next_pending_transcript())

        video_transcript = VideoTranscript.objects.get(post__post_id='vid00000003')
        self.assertEqual(video_transcript.status, TRANSCRIPT_MISSING)
        self.assertTrue(video_transcript.missing_reason.startswith('TranscriptsDisabled'))

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(30)):
            self.assertTrue(classify_next_pending())
        classification.refresh_from_db()
        self.assertEqual(classification.status, CLASSIFICATION_DONE)
        self.assertIn('Transcript:\n(not available)', self.user_message(classification))

    def test_any_failure_while_fetching_ends_the_wait(self):
        self.queue(seen_video('vid00000004'))
        with patch('classification.transcripts.fetch_transcript', side_effect=ValueError('page changed')):
            download_next_pending_transcript()

        video_transcript = VideoTranscript.objects.get(post__post_id='vid00000004')
        self.assertEqual(video_transcript.status, TRANSCRIPT_MISSING)
        self.assertEqual(video_transcript.missing_reason, 'ValueError: page changed')

    def test_other_posts_never_wait_for_transcripts(self):
        self.queue(seen_video('vid00000005'))
        reddit_classification = self.queue(seen_post('p1'))

        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(30)):
            self.assertTrue(classify_next_pending())
        reddit_classification.refresh_from_db()
        self.assertEqual(reddit_classification.status, CLASSIFICATION_DONE)
        self.assertNotIn('Transcript', self.user_message(reddit_classification))

    def test_transcript_requests_have_a_time_limit(self):
        with patch('requests.Session.request') as request:
            SessionWithTimeout().get('https://www.youtube.com/watch?v=vid00000006')
        self.assertEqual(request.call_args.kwargs['timeout'], 10)


def run_worker_until_idle():
    while settle_next_transcripts() or classify_next_pending():
        pass


@override_settings(INFERENCE_SOURCE='openrouter', OPENROUTER_MODEL='test/model', YOUTUBE_SERVER_TRANSCRIPTS=False)
@patch('classification.views.PENDING_WAIT_SECONDS', 0)
class NoTranscriptTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')

    def classify(self, posts):
        response = self.client.post(
            reverse('classify'), {'posts': posts}, content_type='application/json', **bearer(self.token))
        self.assertEqual(response.status_code, 200)
        return response.json()['results']

    def classify_all(self):
        with patch('classification.inference.requests.post', side_effect=fake_model_scoring(30)):
            run_worker_until_idle()

    def classification_statuses(self, video_id):
        return set(Classification.objects.filter(post__post_id=video_id).values_list('status', flat=True))

    def test_a_new_video_is_classified_at_once_on_its_title(self):
        results = self.classify([seen_video('vid00000001')])
        self.assertEqual(results[0], {'platform': 'youtube', 'post_id': 'vid00000001', 'status': 'pending'})
        self.assertFalse(VideoTranscript.objects.exists())

        self.classify_all()
        self.assertEqual(self.classification_statuses('vid00000001'), {CLASSIFICATION_DONE})
        message = Classification.objects.filter(post__post_id='vid00000001').first().prompt[1]['content'][0]['text']
        self.assertIn('Transcript:\n(not available)', message)

    def test_a_transcript_left_pending_from_before_is_settled_after_its_wait(self):
        video = store_post(seen_video('vid00000002'))
        VideoTranscript.objects.create(post=video)
        self.classify([seen_video('vid00000002')])
        VideoTranscript.objects.update(created_at=timezone.now() - timedelta(seconds=6))

        self.classify_all()
        self.assertEqual(VideoTranscript.objects.get(post=video).status, TRANSCRIPT_MISSING)
        self.assertEqual(self.classification_statuses('vid00000002'), {CLASSIFICATION_DONE})

    def test_the_server_never_downloads_transcripts_unless_turned_on(self):
        store_post(seen_video('vid00000008'))
        with patch('classification.transcripts.fetch_transcript') as fetch:
            settle_next_transcripts()
        fetch.assert_not_called()

    @override_settings(YOUTUBE_SERVER_TRANSCRIPTS=True)
    def test_when_turned_on_the_server_downloads_and_browsers_are_not_asked(self):
        results = self.classify([seen_video('vid00000009')])
        self.assertNotIn('transcript_wanted', results[0])

        transcript = fetched_transcript('vid00000009', ['Downloaded by the server.'])
        with patch('classification.transcripts.fetch_transcript', return_value=transcript):
            self.assertTrue(settle_next_transcripts())
        video_transcript = VideoTranscript.objects.get(post__post_id='vid00000009')
        self.assertEqual(video_transcript.status, TRANSCRIPT_FETCHED)
        self.assertEqual(video_transcript.source, TRANSCRIPT_SOURCE_SERVER)
