import json
import tempfile
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings
from django.urls import reverse

from classification import video_sources
from classification.models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_FAILED,
    CLASSIFICATION_PENDING,
    VIDEO_PENDING,
    VIDEO_READY,
    Classification,
    FeatureSet,
    Plugin,
    PostFeatureScores,
    PostJudgment,
    PostVideo,
    UserPlugin,
)
from classification.views import settings_for_user
from classification.worker import classify_next_pending, download_next_pending_video, score_next_pending_features

from .helpers import bearer, create_user_with_token, fake_model_scoring, model_response, seen_post
from .test_videos import (
    MASTER_PLAYLIST,
    ffmpeg_writing_a_clip,
    http_response,
    seen_reddit_video,
    seen_youtube_video,
    sent_video_url,
)

FEATURE_NAMES = ['pull', 'emptiness', 'reply_hook', 'hostility', 'humor']
CALM = dict.fromkeys(FEATURE_NAMES, 0)
# Hook-driven and thin: 6.7 x 6.7 = 44.9, past brainrot's cutoff of 40.
HOOKED_AND_THIN = {**CALM, 'pull': 6.7, 'emptiness': 6.7}
# 6 x 6.6 = 39.6, just short of brainrot's cutoff.
NEARLY_BRAINROT = {**CALM, 'pull': 6, 'emptiness': 6.6}


def rating_response(ratings, cached_tokens=None):
    response = model_response(ratings)
    if cached_tokens is not None:
        body = response.json.return_value
        body['usage']['prompt_tokens_details'] = {'cached_tokens': cached_tokens}
        response.text = json.dumps(body)
    return response


def fake_model_rating(ratings, cached_tokens=None):
    """A stand-in for requests.post that gives every post these feature
    ratings, and answers a rubric as fake_model_scoring does."""
    answer_rubric = fake_model_scoring(0)

    def answer(url, **request):
        if request['json']['response_format']['json_schema']['name'] == 'feature_scores':
            return rating_response(ratings, cached_tokens)
        return answer_rubric(url, **request)
    return answer


def run_worker_until_idle():
    while classify_next_pending() or score_next_pending_features():
        pass


@patch('classification.views.PENDING_WAIT_SECONDS', 0)
class FeatureFilteringTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')
        self.feature_set = FeatureSet.objects.order_by('-version').first()

    def classify(self, posts, token=None):
        response = self.client.post(
            reverse('classify'), {'posts': posts}, content_type='application/json', **bearer(token or self.token))
        self.assertEqual(response.status_code, 200)
        return response.json()['results']

    def rate_every_post(self, ratings, cached_tokens=None):
        with patch('classification.inference.requests.post',
                   side_effect=fake_model_rating(ratings, cached_tokens)) as model_call:
            run_worker_until_idle()
        return model_call

    def test_the_default_filters_share_one_rating_call_per_post(self):
        results = self.classify([seen_post('p1')])
        self.assertEqual(results, [{'platform': 'reddit', 'post_id': 'p1', 'status': 'pending'}])
        self.assertFalse(Classification.objects.exists())
        self.assertEqual(PostFeatureScores.objects.get().feature_set, self.feature_set)

        model_call = self.rate_every_post(CALM)

        self.assertEqual(model_call.call_count, 1)
        self.assertEqual(self.classify([seen_post('p1')]), [{
            'platform': 'reddit', 'post_id': 'p1', 'status': 'done', 'action': 'allow', 'reasons': [],
        }])

    def test_the_rating_call_asks_for_ratings_only_and_its_cached_tokens_are_kept(self):
        self.classify([seen_post('p1')])
        model_call = self.rate_every_post(CALM, cached_tokens=850)

        schema = model_call.call_args.kwargs['json']['response_format']['json_schema']['schema']
        self.assertEqual(schema['required'], FEATURE_NAMES)
        post_feature_scores = PostFeatureScores.objects.get()
        self.assertEqual(post_feature_scores.status, CLASSIFICATION_DONE)
        self.assertEqual(post_feature_scores.scores, CALM)
        self.assertEqual(post_feature_scores.prompt_tokens, 900)
        self.assertEqual(post_feature_scores.cached_prompt_tokens, 850)

    def test_a_hidden_post_names_its_filter_and_the_ratings_behind_it(self):
        self.classify([seen_post('p1')])
        self.rate_every_post(HOOKED_AND_THIN)

        result = self.classify([seen_post('p1')])[0]
        self.assertEqual(result['action'], 'hide')
        # 44.9 is 4.9 past the cutoff of 40, which sits at the default threshold of 60:
        # 60 + 4.9 / 60 x 40 = 63.3.
        self.assertEqual(result['reasons'], [{'plugin': 'Brainrot', 'label': 'pull 6.7, emptiness 6.7', 'score': 63}])

    def test_the_cutoff_sits_at_the_default_threshold_and_the_threshold_still_moves_it(self):
        self.classify([seen_post('p1'), seen_post('p2')])
        with patch('classification.inference.requests.post', side_effect=fake_model_rating(NEARLY_BRAINROT)):
            score_next_pending_features()
        with patch('classification.inference.requests.post', side_effect=fake_model_rating(HOOKED_AND_THIN)):
            score_next_pending_features()

        results = {result['post_id']: result for result in self.classify([seen_post('p1'), seen_post('p2')])}
        self.assertEqual(results['p1']['action'], 'allow')
        self.assertEqual(results['p2']['action'], 'hide')

        brainrot = UserPlugin.objects.filter(user=self.user, plugin__slug='brainrot')
        brainrot.update(threshold=50)
        results = {result['post_id']: result for result in self.classify([seen_post('p1'), seen_post('p2')])}
        self.assertEqual(results['p1']['reasons'][0]['score'], 59)
        self.assertEqual(results['p1']['action'], 'hide')

        brainrot.update(threshold=70)
        results = {result['post_id']: result for result in self.classify([seen_post('p1'), seen_post('p2')])}
        self.assertEqual(results['p2']['action'], 'allow')

    def test_a_turned_off_filter_never_hides_but_the_post_is_still_rated_once(self):
        settings_for_user(self.user)
        UserPlugin.objects.filter(user=self.user, plugin__slug='brainrot').update(enabled=False)
        self.classify([seen_post('p1')])
        self.rate_every_post(HOOKED_AND_THIN)

        result = self.classify([seen_post('p1')])[0]
        self.assertEqual(result['action'], 'allow')

    def test_a_second_reader_reuses_the_ratings(self):
        self.classify([seen_post('p1')])
        self.rate_every_post(HOOKED_AND_THIN)

        _, other_token = create_user_with_token('other@example.com')
        with patch('requests.post') as model_call:
            result = self.classify([seen_post('p1')], token=other_token)[0]
            run_worker_until_idle()
        model_call.assert_not_called()
        self.assertEqual(result['action'], 'hide')
        self.assertEqual(PostFeatureScores.objects.count(), 1)

    def test_failed_ratings_count_as_finished_and_hide_nothing(self):
        self.classify([seen_post('p1')])
        with patch('classification.inference.requests.post', return_value=model_response('not json')):
            run_worker_until_idle()

        self.assertEqual(PostFeatureScores.objects.get().status, CLASSIFICATION_FAILED)
        result = self.classify([seen_post('p1')])[0]
        self.assertEqual((result['status'], result['action']), ('done', 'allow'))

    def test_an_optional_filter_keeps_its_own_rubric_call(self):
        settings_for_user(self.user)
        UserPlugin.objects.create(user=self.user, plugin=Plugin.objects.get(slug='ragebait'), threshold=40)
        results = self.classify([seen_post('p1')])
        self.assertEqual(results[0]['status'], 'pending')
        self.assertEqual(list(Classification.objects.values_list('plugin_version__plugin__slug', flat=True)),
                         ['ragebait'])

        with patch('classification.inference.requests.post', side_effect=fake_model_rating(CALM)):
            self.assertTrue(classify_next_pending())
            self.assertEqual(self.classify([seen_post('p1')])[0]['status'], 'pending')
            self.assertTrue(score_next_pending_features())
        self.assertEqual(self.classify([seen_post('p1')])[0]['status'], 'done')

    @override_settings(FEATURE_SCORING=False)
    def test_turned_off_every_filter_is_judged_by_its_rubric_again(self):
        self.classify([seen_post('p1')])
        self.assertFalse(PostFeatureScores.objects.exists())
        self.assertEqual(Classification.objects.count(), 4)

    @override_settings(DAILY_NEW_POST_QUOTA=1)
    def test_a_post_already_rated_costs_nothing_from_the_daily_quota(self):
        self.classify([seen_post('p1')])
        self.rate_every_post(CALM)

        results = {result['post_id']: result for result in self.classify([seen_post('p1'), seen_post('p2')])}
        self.assertEqual(results['p1']['status'], 'done')
        self.assertEqual(results['p2']['notice'], 'daily_limit_reached')

    @override_settings(YOUTUBE_SERVER_TRANSCRIPTS=True)
    def test_a_youtube_video_is_rated_only_after_its_transcript_is_settled(self):
        self.classify([seen_youtube_video('vid00000001', None)])
        self.assertFalse(score_next_pending_features())
        self.assertEqual(PostFeatureScores.objects.get().status, CLASSIFICATION_PENDING)

    def test_a_thumbs_records_what_the_ratings_decided_and_labels_the_post_by_that_filter(self):
        self.classify([seen_post('p1')])
        self.rate_every_post(HOOKED_AND_THIN)

        response = self.client.post(
            reverse('create_judgment'),
            {'platform': 'reddit', 'post_id': 'p1', 'verdict': 'right', 'shown_action': 'hide',
             'extension_commit': 'abc1234'},
            content_type='application/json', **bearer(self.token))

        self.assertEqual(response.json()['plugin'], 'brainrot')
        filter_results = {result['plugin']: result for result in PostJudgment.objects.get().filter_results}
        self.assertEqual(list(filter_results), ['engagement-bait', 'brainrot', 'rude-or-toxic', 'low-effort'])
        self.assertEqual(filter_results['brainrot'], {
            'plugin': 'brainrot', 'version': None, 'feature_set': self.feature_set.version,
            'threshold': 60, 'flagged_action': 'hide', 'classification_id': None,
            'feature_scores_id': PostFeatureScores.objects.get().id, 'status': CLASSIFICATION_DONE,
            'score': 63, 'label': 'pull 6.7, emptiness 6.7', 'flagged': True,
        })
        self.assertFalse(filter_results['low-effort']['flagged'])


def gemini_rating(ratings):
    """A stand-in for requests.post that answers like the Gemini API with these ratings."""
    def answer(url, **request):
        body = {
            'candidates': [{'content': {'parts': [{'text': json.dumps(ratings)}]}}],
            'usageMetadata': {'promptTokenCount': 1700, 'cachedContentTokenCount': 1000, 'candidatesTokenCount': 40},
        }
        response = MagicMock()
        response.text = json.dumps(body)
        response.json.return_value = body
        response.raise_for_status.return_value = None
        return response
    return answer


@patch('classification.views.PENDING_WAIT_SECONDS', 0)
@override_settings(MEDIA_ROOT=tempfile.mkdtemp(), VIDEO_WATCH_SECONDS=30, GEMINI_API_KEY='')
class FeatureScoringWatchesVideosTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')
        settings_for_user(self.user)
        for platform in video_sources.next_download_at:
            video_sources.next_download_at[platform] = 0.0

    def classify(self, posts):
        response = self.client.post(
            reverse('classify'), {'posts': posts}, content_type='application/json', **bearer(self.token))
        return response.json()['results']

    def download_reddit_clip(self):
        with (
            patch('classification.video_sources.requests.get', return_value=http_response(200, MASTER_PLAYLIST)),
            patch('classification.video_sources.subprocess.run', side_effect=ffmpeg_writing_a_clip),
        ):
            self.assertTrue(download_next_pending_video())

    def test_a_post_with_a_video_is_rated_once_with_the_video_watched(self):
        self.classify([seen_reddit_video('p1')])
        self.assertEqual(PostVideo.objects.get().status, VIDEO_PENDING)
        self.assertFalse(score_next_pending_features())

        self.download_reddit_clip()
        self.assertEqual(PostVideo.objects.get().status, VIDEO_READY)
        with patch('classification.video_judging.requests.post',
                   side_effect=fake_model_rating(HOOKED_AND_THIN)) as model_call:
            self.assertTrue(score_next_pending_features())
            self.assertFalse(score_next_pending_features())

        self.assertEqual(model_call.call_count, 1)
        request = model_call.call_args.kwargs['json']
        self.assertTrue(sent_video_url(request).startswith('data:video/mp4;base64,'))
        self.assertEqual(request['provider']['only'], ['google-ai-studio'])
        self.assertEqual(request['response_format']['json_schema']['schema']['required'], FEATURE_NAMES)
        post_feature_scores = PostFeatureScores.objects.get()
        self.assertEqual(post_feature_scores.scores, HOOKED_AND_THIN)
        self.assertEqual(post_feature_scores.model, 'google/gemini-3.5-flash-lite')
        self.assertIn('Video attached: the first 30 seconds', json.dumps(post_feature_scores.prompt))
        self.assertIn(f'post_video:{PostVideo.objects.get().id}', json.dumps(post_feature_scores.prompt))
        self.assertEqual(self.classify([seen_reddit_video('p1')])[0]['action'], 'hide')

    def test_the_video_is_watched_whichever_default_filter_the_reader_has_on(self):
        UserPlugin.objects.filter(user=self.user).exclude(plugin__slug='rude-or-toxic').update(enabled=False)
        self.classify([seen_reddit_video('p1')])
        self.assertEqual(PostVideo.objects.get().status, VIDEO_PENDING)

    @override_settings(GEMINI_API_KEY='test-gemini-key')
    def test_through_gemini_the_ratings_and_cached_tokens_are_kept(self):
        self.classify([seen_reddit_video('p1')])
        self.download_reddit_clip()
        with patch('classification.video_judging.requests.post', side_effect=gemini_rating(CALM)) as model_call:
            self.assertTrue(score_next_pending_features())

        request = model_call.call_args.kwargs['json']
        self.assertEqual(request['generationConfig']['responseJsonSchema']['required'], FEATURE_NAMES)
        post_feature_scores = PostFeatureScores.objects.get()
        self.assertEqual(post_feature_scores.status, CLASSIFICATION_DONE)
        self.assertEqual(post_feature_scores.inference_source, 'gemini')
        self.assertEqual(post_feature_scores.scores, CALM)
        self.assertEqual(post_feature_scores.prompt_tokens, 1700)
        self.assertEqual(post_feature_scores.cached_prompt_tokens, 1000)
