import importlib
import json
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.apps import apps
from django.test import TestCase, override_settings
from django.urls import reverse

from classification import video_sources
from classification.models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_PENDING,
    PLUGIN_INPUT_VIDEO,
    VIDEO_MISSING,
    VIDEO_PENDING,
    VIDEO_READY,
    Classification,
    Plugin,
    Post,
    PostVideo,
    UserPlugin,
)
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


# What brainrot's criteria say of a video built to hold attention, and of a calm, substantive one.
BRAINROT_VIDEO = {'stimulation_is_the_point': True, 'made_for_the_next_one': True, 'has_substance': False}
CALM_LESSON = {'stimulation_is_the_point': False, 'made_for_the_next_one': False, 'has_substance': True}


def model_answering(criteria_met):
    """A stand-in for requests.post that answers like the chat completions API,
    with these criterion answers, whether or not a video is attached."""
    def answer(url, **request):
        return model_response({'reasoning': 'Fast cuts over a loud track; nothing is explained.', **criteria_met})
    return answer


def gemini_answering(criteria_met):
    """A stand-in for requests.post that answers like the Gemini API."""
    def answer(url, **request):
        answer_text = json.dumps({'reasoning': 'A calm lecture with slow animations.', **criteria_met})
        body = {
            'candidates': [{'content': {'parts': [{'text': answer_text}]}}],
            'usageMetadata': {'promptTokenCount': 1700, 'candidatesTokenCount': 70, 'thoughtsTokenCount': 5},
        }
        response = MagicMock()
        response.text = json.dumps(body)
        response.json.return_value = body
        response.raise_for_status.return_value = None
        return response
    return answer


def sent_video_url(request_body):
    """The video attached to a chat completions request, or None."""
    for part in request_body['messages'][1]['content']:
        if part['type'] == 'video_url':
            return part['video_url']['url']
    return None


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
@override_settings(MEDIA_ROOT=tempfile.mkdtemp(), VIDEO_MAX_YOUTUBE_SECONDS=180, VIDEO_WATCH_SECONDS=30, GEMINI_API_KEY='')
@override_settings(FEATURE_SCORING=False)
class BrainrotWatchesVideosTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')
        settings_for_user(self.user)
        # Only Brainrot is on, so every model call below is Brainrot's.
        UserPlugin.objects.filter(user=self.user).exclude(plugin__slug='brainrot').update(enabled=False)
        self.brainrot = Plugin.objects.get(slug='brainrot')
        for platform in video_sources.next_download_at:
            video_sources.next_download_at[platform] = 0.0

    def classify(self, posts):
        return self.client.post(reverse('classify'), {'posts': posts}, content_type='application/json', **bearer(self.token))

    def brainrot_classification(self, post_id):
        return Classification.objects.get(post__post_id=post_id, plugin_version__plugin=self.brainrot)

    def download_reddit_clip(self):
        with (
            patch('classification.video_sources.requests.get', return_value=http_response(200, MASTER_PLAYLIST)),
            patch('classification.video_sources.subprocess.run', side_effect=ffmpeg_writing_a_clip),
        ):
            self.assertTrue(download_next_pending_video())

    def test_a_post_without_a_video_is_judged_on_its_text_and_one_with_a_video_waits_for_it(self):
        self.classify([seen_post('p1'), seen_reddit_video('p2')])
        self.assertEqual(PostVideo.objects.get(post__post_id='p2').status, VIDEO_PENDING)

        with patch('classification.inference.requests.post', side_effect=model_answering(CALM_LESSON)) as model_call:
            self.assertTrue(classify_next_pending())
            self.assertFalse(classify_next_pending())
        self.assertEqual(model_call.call_count, 1)
        self.assertIsNone(sent_video_url(model_call.call_args.kwargs['json']))
        self.assertIn('/chat/completions', model_call.call_args.args[0])
        self.assertEqual(self.brainrot_classification('p1').status, CLASSIFICATION_DONE)
        self.assertEqual(self.brainrot_classification('p2').status, CLASSIFICATION_PENDING)

    def test_a_reddit_video_is_downloaded_once_and_judged_by_brainrot_with_its_clip(self):
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

        with patch('classification.video_judging.requests.post', side_effect=model_answering(BRAINROT_VIDEO)) as model_call:
            self.assertTrue(classify_next_pending())
        self.assertTrue(sent_video_url(model_call.call_args.kwargs['json']).startswith('data:video/mp4;base64,'))
        request = model_call.call_args.kwargs['json']
        self.assertEqual(request['provider']['only'], ['google-ai-studio'])
        # The same criteria as for any post.
        self.assertEqual(
            set(request['response_format']['json_schema']['schema']['properties']),
            {'reasoning', 'stimulation_is_the_point', 'made_for_the_next_one', 'has_substance'},
        )

        classification = self.brainrot_classification('p1')
        self.assertEqual(classification.plugin_version, self.brainrot.latest_version())
        self.assertEqual(classification.status, CLASSIFICATION_DONE)
        self.assertEqual(classification.score, 80)
        self.assertEqual(classification.label, 'stimulation_is_the_point')
        self.assertEqual(classification.criteria_met, ['stimulation_is_the_point', 'made_for_the_next_one'])
        self.assertEqual(classification.prompt_tokens, 900)
        self.assertIn(f'post_video:{post_video.id}', json.dumps(classification.prompt))
        self.assertIn('Video attached: the first 30 seconds', json.dumps(classification.prompt))

        response = self.classify([seen_reddit_video('p1')])
        self.assertEqual(response.json()['results'][0]['action'], 'hide')
        with patch('classification.video_sources.requests.get') as site:
            self.assertFalse(download_next_pending_video())
        site.assert_not_called()

    def test_a_playlist_off_reddit_is_never_fetched_and_the_post_is_judged_on_its_text(self):
        self.classify([seen_reddit_video('p1', video_url='https://example.com/HLSPlaylist.m3u8')])
        self.assertFalse(PostVideo.objects.exists())

        with patch('classification.inference.requests.post', side_effect=model_answering(CALM_LESSON)) as model_call:
            self.assertTrue(classify_next_pending())
        self.assertIsNone(sent_video_url(model_call.call_args.kwargs['json']))
        self.assertEqual(self.brainrot_classification('p1').status, CLASSIFICATION_DONE)

    def test_readers_without_brainrot_record_no_videos(self):
        UserPlugin.objects.filter(user=self.user, plugin=self.brainrot).update(enabled=False)
        UserPlugin.objects.filter(user=self.user, plugin__slug='ragebait').update(enabled=True)
        self.classify([seen_reddit_video('p1')])

        self.assertFalse(PostVideo.objects.exists())
        # The post still records where its video plays, for when Brainrot is turned on.
        self.assertEqual(Post.objects.get(post_id='p1').video_url, REDDIT_PLAYLIST)

    def test_a_refused_download_pauses_that_site_and_the_post_is_judged_without_its_video(self):
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

        with patch('classification.inference.requests.post', side_effect=model_answering(CALM_LESSON)) as model_call:
            self.assertTrue(classify_next_pending())
            self.assertFalse(classify_next_pending())
        self.assertIsNone(sent_video_url(model_call.call_args.kwargs['json']))
        self.assertIn('Video: yes (its thumbnail is among the images)', json.dumps(model_call.call_args.kwargs['json']))
        self.assertEqual(self.brainrot_classification('p1').status, CLASSIFICATION_DONE)
        self.assertEqual(self.brainrot_classification('p2').status, CLASSIFICATION_PENDING)

    def test_downloads_from_one_site_are_spaced_out(self):
        self.classify([seen_reddit_video('p1'), seen_reddit_video('p2')])
        self.download_reddit_clip()
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

    def test_the_video_of_a_quoted_x_post_is_watched_with_the_quoting_post(self):
        self.classify([seen_post(
            '2123077080887984588', platform='x', text='Yeah they better find that new CEO real quick',
            video_url='https://x.com/chrisheatherly/status/2123077080887984588',
            quoted_post={'author': 'MarioNawfal', 'url': '', 'text': 'Nvidia confirms Huang will NOT return as CEO!'})])
        # As the embed endpoint answered for this post: no media of its own, the video in the quoted post.
        embed = {'text': 'Yeah they better find that new CEO real quick', 'quoted_tweet': {'mediaDetails': [
            {'type': 'video', 'video_info': {'duration_millis': 33767, 'variants': [
                {'content_type': 'video/mp4', 'bitrate': 832000, 'url': 'https://video.twimg.com/amplify_video/2/vid/480x270/d.mp4'},
                {'content_type': 'video/mp4', 'bitrate': 256000, 'url': 'https://video.twimg.com/amplify_video/2/vid/320x180/e.mp4'},
            ]}}]}}
        with (
            patch('classification.video_sources.requests.get', return_value=http_response(200, json_body=embed)),
            patch('classification.video_sources.subprocess.run', side_effect=ffmpeg_writing_a_clip) as ffmpeg,
        ):
            self.assertTrue(download_next_pending_video())
        self.assertIn('https://video.twimg.com/amplify_video/2/vid/320x180/e.mp4', ffmpeg.call_args_list[0].args[0])
        self.assertEqual(PostVideo.objects.get(post__post_id='2123077080887984588').status, VIDEO_READY)

        with patch('classification.video_judging.requests.post', side_effect=model_answering(CALM_LESSON)) as model_call:
            self.assertTrue(classify_next_pending())
        described_post = model_call.call_args.kwargs['json']['messages'][1]['content'][1]['text']
        self.assertIn('Quoted post, by MarioNawfal:\nNvidia confirms Huang will NOT return as CEO!', described_post)

    def test_a_reddit_gif_is_watched_from_its_mp4_copy(self):
        gif_copy = 'https://preview.redd.it/bs84o9vpbf2i1.gif?width=400&format=mp4&s=1d5a5be00826bda'
        self.classify([seen_reddit_video('p1', video_url=gif_copy)])
        with (
            patch('classification.video_sources.requests.get') as site,
            patch('classification.video_sources.subprocess.run', side_effect=ffmpeg_writing_a_clip) as ffmpeg,
        ):
            self.assertTrue(download_next_pending_video())
        site.assert_not_called()
        self.assertIn(gif_copy, ffmpeg.call_args_list[0].args[0])
        self.assertEqual(PostVideo.objects.get(post__post_id='p1').status, VIDEO_READY)

    def test_a_short_youtube_video_is_watched_by_url_without_any_download(self):
        self.classify([seen_youtube_video('vid00000001', 95)])
        self.assertEqual(PostVideo.objects.get(post__post_id='vid00000001').status, VIDEO_READY)

        with (
            patch('classification.video_sources.requests.get') as site,
            patch('classification.video_judging.requests.post', side_effect=model_answering(CALM_LESSON)) as model_call,
        ):
            self.assertFalse(download_next_pending_video())
            self.assertTrue(classify_next_pending())
        site.assert_not_called()
        self.assertEqual(sent_video_url(model_call.call_args.kwargs['json']), 'https://www.youtube.com/watch?v=vid00000001')
        classification = self.brainrot_classification('vid00000001')
        self.assertEqual(classification.score, 0)
        self.assertEqual(classification.label, 'none')

    def test_a_video_is_watched_once_and_its_verdict_reused_for_every_reader(self):
        self.classify([seen_youtube_video('vid00000001', 95)])
        with patch('classification.video_judging.requests.post', side_effect=model_answering(BRAINROT_VIDEO)) as model_call:
            self.assertTrue(classify_next_pending())
        self.assertEqual(model_call.call_count, 1)

        other_reader, other_token = create_user_with_token('other@example.com')
        settings_for_user(other_reader)
        UserPlugin.objects.filter(user=other_reader).exclude(plugin=self.brainrot).update(enabled=False)
        with patch('requests.post') as model_call:
            response = self.client.post(
                reverse('classify'), {'posts': [seen_youtube_video('vid00000001', 95)]},
                content_type='application/json', **bearer(other_token))
            self.assertFalse(classify_next_pending())
        model_call.assert_not_called()
        self.assertEqual(PostVideo.objects.count(), 1)
        self.assertEqual(Classification.objects.filter(plugin_version__plugin=self.brainrot).count(), 1)
        self.assertEqual(response.json()['results'][0]['action'], 'hide')

    def test_long_and_unmeasured_youtube_videos_are_judged_without_being_watched(self):
        self.classify([
            seen_youtube_video('vid00000001', 181),
            seen_youtube_video('vid00000002', None),
            seen_youtube_video('vid00000003', None, url='https://www.youtube.com/shorts/vid00000003'),
        ])
        statuses = dict(PostVideo.objects.values_list('post__post_id', 'status'))
        self.assertEqual(statuses, {'vid00000001': VIDEO_MISSING, 'vid00000002': VIDEO_MISSING, 'vid00000003': VIDEO_READY})

        # The text and the video judgments both go through requests.post.
        with patch('requests.post', side_effect=model_answering(CALM_LESSON)) as model_call:
            while classify_next_pending():
                pass
        watched = [sent_video_url(call.kwargs['json']) for call in model_call.call_args_list]
        self.assertEqual(sorted(watched, key=str), [None, None, 'https://www.youtube.com/shorts/vid00000003'])
        for video_id in ['vid00000001', 'vid00000002', 'vid00000003']:
            self.assertEqual(self.brainrot_classification(video_id).status, CLASSIFICATION_DONE)


@patch('classification.views.PENDING_WAIT_SECONDS', 0)
@override_settings(MEDIA_ROOT=tempfile.mkdtemp(), VIDEO_WATCH_SECONDS=15, GEMINI_API_KEY='test-gemini-key')
@override_settings(FEATURE_SCORING=False)
class GeminiVideoTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')
        settings_for_user(self.user)
        UserPlugin.objects.filter(user=self.user).exclude(plugin__slug='brainrot').update(enabled=False)
        self.brainrot = Plugin.objects.get(slug='brainrot')
        for platform in video_sources.next_download_at:
            video_sources.next_download_at[platform] = 0.0

    def classify(self, posts):
        return self.client.post(reverse('classify'), {'posts': posts}, content_type='application/json', **bearer(self.token))

    def brainrot_classification(self, post_id):
        return Classification.objects.get(post__post_id=post_id, plugin_version__plugin=self.brainrot)

    def test_any_youtube_video_is_watched_for_its_opening_seconds_only(self):
        self.classify([seen_youtube_video('vid00000001', 3600), seen_youtube_video('vid00000002', None)])
        self.assertEqual(set(PostVideo.objects.values_list('status', flat=True)), {VIDEO_READY})

        with patch('classification.video_judging.requests.post', side_effect=gemini_answering(CALM_LESSON)) as model_call:
            while classify_next_pending():
                pass
        self.assertEqual(model_call.call_count, 2)
        request = model_call.call_args_list[0]
        self.assertIn('/models/gemini-3.5-flash-lite:generateContent', request.args[0])
        self.assertEqual(request.kwargs['headers'], {'x-goog-api-key': 'test-gemini-key'})
        video_part = request.kwargs['json']['contents'][0]['parts'][0]
        self.assertEqual(video_part, {
            'fileData': {'fileUri': 'https://www.youtube.com/watch?v=vid00000001'},
            'videoMetadata': {'startOffset': '0s', 'endOffset': '15s'},
        })

        classification = self.brainrot_classification('vid00000001')
        self.assertEqual(classification.status, CLASSIFICATION_DONE)
        self.assertEqual(classification.inference_source, 'gemini')
        self.assertEqual(classification.score, 0)
        self.assertEqual(classification.criteria_met, ['has_substance'])
        self.assertEqual(classification.prompt_tokens, 1700)
        self.assertEqual(classification.completion_tokens, 75)
        self.assertIn('Video attached: the first 15 seconds', json.dumps(classification.prompt))

    def test_a_reddit_clip_is_sent_inline_and_stored_as_a_reference(self):
        self.classify([seen_reddit_video('p1')])
        with (
            patch('classification.video_sources.requests.get', return_value=http_response(200, MASTER_PLAYLIST)),
            patch('classification.video_sources.subprocess.run', side_effect=ffmpeg_writing_a_clip) as ffmpeg,
        ):
            download_next_pending_video()
        self.assertEqual(ffmpeg.call_args_list[0].args[0][ffmpeg.call_args_list[0].args[0].index('-t') + 1], '15')

        with patch('classification.video_judging.requests.post', side_effect=gemini_answering(BRAINROT_VIDEO)) as model_call:
            self.assertTrue(classify_next_pending())
        sent_part = model_call.call_args.kwargs['json']['contents'][0]['parts'][0]
        self.assertEqual(sent_part['inlineData']['mimeType'], 'video/mp4')
        self.assertNotIn('post_video:', sent_part['inlineData']['data'])
        classification = self.brainrot_classification('p1')
        stored_part = classification.prompt['contents'][0]['parts'][0]
        self.assertEqual(stored_part['inlineData']['data'], f'post_video:{PostVideo.objects.get().id}')
        self.assertEqual(classification.score, 80)
        self.assertEqual(classification.label, 'stimulation_is_the_point')


class OneBrainrotFilterTests(TestCase):
    def test_brainrot_watches_videos_and_the_brainrot_video_prototype_is_unlisted(self):
        self.assertEqual(Plugin.objects.get(slug='brainrot').input_kind, PLUGIN_INPUT_VIDEO)
        self.assertFalse(Plugin.objects.get(slug='video-brainrot').is_listed)

    def test_installs_of_the_brainrot_video_prototype_are_turned_off_and_kept(self):
        user, _ = create_user_with_token('reader@example.com')
        install = UserPlugin.objects.create(user=user, plugin=Plugin.objects.get(slug='video-brainrot'), threshold=67)
        one_brainrot = importlib.import_module('classification.migrations.0019_one_brainrot')
        one_brainrot.make_brainrot_watch_videos(apps, None)

        install.refresh_from_db()
        self.assertFalse(install.enabled)
        self.assertEqual(install.threshold, 67)


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
