from unittest.mock import patch

from django.test import TestCase, override_settings
from youtube_transcript_api import FetchedTranscript, FetchedTranscriptSnippet, TranscriptsDisabled

from classification.models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_PENDING,
    TRANSCRIPT_FETCHED,
    TRANSCRIPT_MISSING,
    TRANSCRIPT_PENDING,
    Classification,
    Plugin,
    VideoTranscript,
)
from classification.transcripts import SessionWithTimeout
from classification.views import store_post
from classification.worker import classify_next_pending, download_next_pending_transcript

from .helpers import fake_model_scoring, seen_post


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


@override_settings(INFERENCE_SOURCE='openrouter', OPENROUTER_MODEL='test/model')
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
