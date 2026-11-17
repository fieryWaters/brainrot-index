import time
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.urls import reverse

from classification.models import ExtensionToken, PostSubmission
from classification.views import record_submissions, store_post

from .helpers import bearer, create_user_with_token, seen_post


@patch('classification.views.PENDING_WAIT_SECONDS', 0)
class PostSubmissionTests(TestCase):
    def setUp(self):
        self.user, self.token = create_user_with_token('reader@example.com')

    def classify(self, posts, token=None):
        return self.client.post(
            reverse('classify'), {'posts': posts}, content_type='application/json', **bearer(token or self.token))

    def test_every_post_sent_is_recorded_with_the_account_and_connection(self):
        self.classify([seen_post('p1'), seen_post('p2')])

        submissions = PostSubmission.objects.filter(user=self.user).order_by('post__post_id')
        self.assertEqual([submission.post.post_id for submission in submissions], ['p1', 'p2'])
        token = ExtensionToken.objects.get(user=self.user)
        for submission in submissions:
            self.assertEqual(submission.extension_token, token)
            self.assertEqual(submission.times_seen, 1)
            self.assertEqual(submission.first_seen_at, submission.last_seen_at)

    def test_sending_again_counts_up_and_keeps_the_first_time(self):
        self.classify([seen_post('p1')])
        first = PostSubmission.objects.get(post__post_id='p1')

        # The answer is cached by now; it is recorded all the same.
        self.classify([seen_post('p1'), seen_post('p1')])

        again = PostSubmission.objects.get(post__post_id='p1')
        self.assertEqual(again.times_seen, 2)
        self.assertEqual(again.first_seen_at, first.first_seen_at)
        self.assertGreaterEqual(again.last_seen_at, first.last_seen_at)

    def test_each_account_has_its_own_row(self):
        _, other_token = create_user_with_token('other@example.com')
        self.classify([seen_post('p1')])
        self.classify([seen_post('p1')], token=other_token)

        self.assertEqual(PostSubmission.objects.filter(post__post_id='p1').count(), 2)

    @override_settings(DAILY_NEW_POST_QUOTA=1)
    def test_a_post_refused_by_the_daily_quota_is_not_recorded(self):
        self.classify([seen_post('p1'), seen_post('p2')])

        self.assertEqual(list(PostSubmission.objects.values_list('post__post_id', flat=True)), ['p1'])

    def test_recording_a_full_request_is_quick(self):
        posts = [store_post(seen_post(f'p{index}')) for index in range(25)]
        token = ExtensionToken.objects.get(user=self.user)
        record_submissions(self.user, token, posts)

        started_at = time.monotonic()
        record_submissions(self.user, token, posts)
        elapsed = time.monotonic() - started_at

        print(f"\nRecording 25 sent posts took {elapsed * 1000:.1f} ms")
        self.assertLess(elapsed, 0.05)
        self.assertEqual(set(PostSubmission.objects.values_list('times_seen', flat=True)), {2})
