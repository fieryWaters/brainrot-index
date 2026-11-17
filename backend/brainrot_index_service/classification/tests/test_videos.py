import json
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from django.urls import reverse

from classification import video_sources
from classification.models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_FAILED,
    CLASSIFICATION_NOT_APPLICABLE,
    CLASSIFICATION_PENDING,
    VIDEO_MISSING,
    VIDEO_PENDING,
    VIDEO_READY,
    Classification,
    Plugin,
    PostVideo,
    UserPlugin,
    VideoTranscript,
)
from classification.video_judging import brainrot_points, parse_answer, score_from_points
from classification.video_sources import hls_stream_urls, x_embed_token
from classification.views import settings_for_user
from classification.worker import classify_next_pending, download_next_pending_video

from .helpers import bearer, create_user_with_token, model_response, seen_post

REDDIT_PLAYLIST = 'https://cf.v.redd.it/abc123/HLSPlaylist.m3u8?f=sd&a=1797540252%2Csigned'
MASTER_PLAYLIST = """\
#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="audio",URI="CMAF_AUDIO_128.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=854x480,AUDIO="audio"
CMAF_480.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240,AUDIO="audio"
CMAF_240.m3u8
"""


def seen_reddit_video(post_id, video_url=REDDIT_PLAYLIST):
    return seen_post(post_id, text='Watch this', video_url=video_url)


def seen_youtube_video(video_id, duration_seconds, url=None):
    return seen_post(
        video_id,
        text='A video title',
        platform='youtube',
        url=url or f'https://www.youtube.com/watch?v={video_id}',
        community='',
        image_urls=[],
        video_duration_seconds=duration_seconds,
    )


def http_response(status_code, text='', json_body=None):
    response = MagicMock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = json_body
    return response


def model_watching(engagement, information, cognitive):
    """A stand-in for requests.post that answers every video with these criterion scores."""
    def answer(url, **request):
        return model_response({
            'observations': 'Fast cuts every second over a loud track; nothing is explained.',
            'engagement_power': engagement,
            'information_content': information,
            'cognitive_draw': cognitive,
        })
    return answer


def ffmpeg_writing_a_clip(command, **arguments):
    """A stand-in for subprocess.run: ffmpeg writes a few bytes to its output
    path (the last argument) and ffprobe reports 30 seconds."""
    finished = MagicMock(returncode=0, stderr='')
    if command[0] == 'ffmpeg':
        Path(command[-1]).write_bytes(b'fake mp4 bytes')
    else:
        finished.stdout = '30.0\n'
    return finished


@patch('classification.views.PENDING_WAIT_SECONDS', 0)
@override_settings(MEDIA_ROOT=tempfile.mkdtemp(), VIDEO_MAX_YOUTUBE_SECONDS=180, VIDEO_WATCH_SECONDS=30)
class VideoFilterTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')
        settings_for_user(self.user)
        # Only the video filter is on, so every model call below is a video judgment.
        UserPlugin.objects.filter(user=self.user).update(enabled=False)
        self.video_plugin = Plugin.objects.get(slug='video-brainrot')
        UserPlugin.objects.create(user=self.user, plugin=self.video_plugin, threshold=67)
        for platform in video_sources.next_download_at:
            video_sources.next_download_at[platform] = 0.0

    def classify(self, posts):
        return self.client.post(reverse('classify'), {'posts': posts}, content_type='application/json', **bearer(self.token))

    def video_classification(self, post_id):
        return Classification.objects.get(post__post_id=post_id, plugin_version__plugin=self.video_plugin)

    def test_the_video_filter_skips_posts_without_a_video(self):
        response = self.classify([seen_post('p1'), seen_reddit_video('p2')])

        self.assertEqual(self.video_classification('p1').status, CLASSIFICATION_NOT_APPLICABLE)
        self.assertEqual(self.video_classification('p2').status, CLASSIFICATION_PENDING)
        self.assertEqual(PostVideo.objects.get(post__post_id='p2').status, VIDEO_PENDING)
        results = {result['post_id']: result for result in response.json()['results']}
        self.assertEqual(results['p1']['status'], 'done')
        self.assertEqual(results['p1']['action'], 'allow')
        self.assertEqual(results['p2']['status'], 'pending')

    def test_a_playlist_off_reddit_is_never_fetched(self):
        self.classify([seen_reddit_video('p1', video_url='https://example.com/HLSPlaylist.m3u8')])

        self.assertFalse(PostVideo.objects.exists())
        self.assertEqual(self.video_classification('p1').status, CLASSIFICATION_NOT_APPLICABLE)

    def test_readers_without_a_video_filter_record_no_videos(self):
        UserPlugin.objects.filter(user=self.user, plugin=self.video_plugin).update(enabled=False)
        UserPlugin.objects.filter(user=self.user, plugin__slug='ragebait').update(enabled=True)
        self.classify([seen_reddit_video('p1')])

        self.assertFalse(PostVideo.objects.exists())

    def test_a_reddit_video_is_downloaded_once_and_judged_on_its_clip(self):
        self.classify([seen_reddit_video('p1')])
        with (
            patch('classification.video_sources.requests.get', return_value=http_response(200, MASTER_PLAYLIST)) as site,
            patch('classification.video_sources.subprocess.run', side_effect=ffmpeg_writing_a_clip) as ffmpeg,
        ):
            self.assertTrue(download_next_pending_video())
        self.assertEqual(site.call_count, 1)
        ffmpeg_command = ffmpeg.call_args_list[0].args[0]
        self.assertIn('https://cf.v.redd.it/abc123/CMAF_240.m3u8', ffmpeg_command)
        self.assertIn('https://cf.v.redd.it/abc123/CMAF_AUDIO_128.m3u8', ffmpeg_command)
        self.assertEqual(ffmpeg_command[ffmpeg_command.index('-t') + 1], '30')

        post_video = PostVideo.objects.get(post__post_id='p1')
        self.assertEqual(post_video.status, VIDEO_READY)
        self.assertEqual(post_video.clip_seconds, 30.0)

        with patch('classification.video_judging.requests.post', side_effect=model_watching(5, 0, 0)) as model_call:
            self.assertTrue(classify_next_pending())
        sent_video = model_call.call_args.kwargs['json']['messages'][1]['content'][0]['video_url']['url']
        self.assertTrue(sent_video.startswith('data:video/mp4;base64,'))

        classification = self.video_classification('p1')
        self.assertEqual(classification.status, CLASSIFICATION_DONE)
        self.assertEqual(classification.score, 100)
        self.assertEqual(classification.label, 'brainrot')
        self.assertEqual(classification.prompt_tokens, 900)
        self.assertEqual(classification.completion_tokens, 60)
        self.assertIn(f'post_video:{post_video.id}', json.dumps(classification.prompt))
        self.assertIn('Video shown: the first 30 seconds', json.dumps(classification.prompt))

        response = self.classify([seen_reddit_video('p1')])
        self.assertEqual(response.json()['results'][0]['action'], 'hide')
        with patch('classification.video_sources.requests.get') as site:
            self.assertFalse(download_next_pending_video())
        site.assert_not_called()

    def test_a_refusal_pauses_downloads_from_that_site(self):
        self.classify([seen_reddit_video('p1'), seen_reddit_video('p2')])
        with patch('classification.video_sources.requests.get', return_value=http_response(429)):
            self.assertTrue(download_next_pending_video())
        refused = PostVideo.objects.get(post__post_id='p1')
        self.assertEqual(refused.status, VIDEO_MISSING)
        self.assertIn('429', refused.missing_reason)
        self.assertGreater(video_sources.next_download_at['reddit'], time.monotonic() + 3000)

        with patch('classification.video_sources.requests.get') as site:
            self.assertFalse(download_next_pending_video())
        site.assert_not_called()
        self.assertEqual(PostVideo.objects.get(post__post_id='p2').status, VIDEO_PENDING)

        with patch('classification.video_judging.requests.post') as model_call:
            classify_next_pending()
        model_call.assert_not_called()
        self.assertEqual(self.video_classification('p1').status, CLASSIFICATION_FAILED)

    def test_downloads_from_one_site_are_spaced_out(self):
        self.classify([seen_reddit_video('p1'), seen_reddit_video('p2')])
        with (
            patch('classification.video_sources.requests.get', return_value=http_response(200, MASTER_PLAYLIST)),
            patch('classification.video_sources.subprocess.run', side_effect=ffmpeg_writing_a_clip),
        ):
            self.assertTrue(download_next_pending_video())
            self.assertFalse(download_next_pending_video())
        self.assertEqual(PostVideo.objects.get(post__post_id='p2').status, VIDEO_PENDING)

    def test_an_x_video_is_found_through_the_embed_endpoint(self):
        self.classify([seen_post('2072832093684678915', platform='x', video_url='https://x.com/a/status/2072832093684678915')])
        embed = {'mediaDetails': [{'type': 'video', 'video_info': {'duration_millis': 41400, 'variants': [
            {'content_type': 'application/x-mpegURL', 'url': 'https://video.twimg.com/amplify_video/1/pl/a.m3u8'},
            {'content_type': 'video/mp4', 'bitrate': 950000, 'url': 'https://video.twimg.com/amplify_video/1/vid/480x640/b.mp4'},
            {'content_type': 'video/mp4', 'bitrate': 632000, 'url': 'https://video.twimg.com/amplify_video/1/vid/320x426/c.mp4'},
        ]}}]}
        with (
            patch('classification.video_sources.requests.get', return_value=http_response(200, json_body=embed)) as site,
            patch('classification.video_sources.subprocess.run', side_effect=ffmpeg_writing_a_clip) as ffmpeg,
        ):
            self.assertTrue(download_next_pending_video())
        self.assertEqual(site.call_args.kwargs['params']['id'], '2072832093684678915')
        self.assertIn('https://video.twimg.com/amplify_video/1/vid/320x426/c.mp4', ffmpeg.call_args_list[0].args[0])
        post_video = PostVideo.objects.get(post__post_id='2072832093684678915')
        self.assertEqual(post_video.status, VIDEO_READY)
        self.assertEqual(post_video.duration_seconds, 41)

    def test_a_short_youtube_video_is_watched_by_url_without_any_download(self):
        self.classify([seen_youtube_video('vid00000001', 95)])
        VideoTranscript.objects.update(status='missing')
        self.assertEqual(PostVideo.objects.get(post__post_id='vid00000001').status, VIDEO_READY)

        with (
            patch('classification.video_sources.requests.get') as site,
            patch('classification.video_judging.requests.post', side_effect=model_watching(1, 5, 4)) as model_call,
        ):
            self.assertFalse(download_next_pending_video())
            self.assertTrue(classify_next_pending())
        site.assert_not_called()
        request = model_call.call_args.kwargs['json']
        self.assertEqual(request['messages'][1]['content'][0]['video_url']['url'], 'https://www.youtube.com/watch?v=vid00000001')
        self.assertEqual(request['provider']['only'], ['google-ai-studio'])
        classification = self.video_classification('vid00000001')
        self.assertEqual(classification.score, 13)
        self.assertEqual(classification.label, 'not_brainrot')

    def test_long_and_unmeasured_youtube_videos_are_not_watched(self):
        self.classify([
            seen_youtube_video('vid00000001', 181),
            seen_youtube_video('vid00000002', None),
            seen_youtube_video('vid00000003', None, url='https://www.youtube.com/shorts/vid00000003'),
        ])
        VideoTranscript.objects.update(status='missing')
        statuses = dict(PostVideo.objects.values_list('post__post_id', 'status'))
        self.assertEqual(statuses, {'vid00000001': VIDEO_MISSING, 'vid00000002': VIDEO_MISSING, 'vid00000003': VIDEO_READY})

        with patch('classification.video_judging.requests.post', side_effect=model_watching(5, 0, 0)) as model_call:
            while classify_next_pending():
                pass
        self.assertEqual(model_call.call_count, 1)
        self.assertEqual(self.video_classification('vid00000001').status, CLASSIFICATION_FAILED)


class VideoRubricTests(TestCase):
    def test_points_count_engagement_for_and_substance_against(self):
        answer = {'engagement_power': 4, 'information_content': 1, 'cognitive_draw': 2}
        self.assertEqual(brainrot_points(answer), 4 + 4 + 3)
        self.assertEqual(score_from_points(11), 73)

    def test_an_answer_out_of_range_or_incomplete_is_invalid(self):
        valid = {'observations': 'Calm narration.', 'engagement_power': 1, 'information_content': 5, 'cognitive_draw': 4}
        self.assertEqual(parse_answer(json.dumps(valid)), valid)
        self.assertIsNone(parse_answer(json.dumps({**valid, 'engagement_power': 6})))
        self.assertIsNone(parse_answer(json.dumps({**valid, 'cognitive_draw': True})))
        self.assertIsNone(parse_answer(json.dumps({key: value for key, value in valid.items() if key != 'observations'})))


class VideoSourceTests(TestCase):
    def test_the_smallest_variant_and_its_audio_are_read(self):
        with patch('classification.video_sources.requests.get', return_value=http_response(200, MASTER_PLAYLIST)):
            self.assertEqual(hls_stream_urls(REDDIT_PLAYLIST), [
                'https://cf.v.redd.it/abc123/CMAF_240.m3u8',
                'https://cf.v.redd.it/abc123/CMAF_AUDIO_128.m3u8',
            ])

    def test_the_x_embed_token_has_no_zeros_or_point(self):
        token = x_embed_token('2072832093684678915')
        self.assertRegex(token, r'^[1-9a-z]+$')
