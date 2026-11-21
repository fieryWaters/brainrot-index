import json
from io import StringIO
from unittest.mock import patch

from django.core import mail
from django.core.management import CommandError, call_command
from django.test import Client, TestCase, override_settings
from django.urls import reverse

from api.sign_in import SIGN_IN_GOOGLE, SIGN_IN_METHOD_SESSION_KEY, SIGN_IN_PASSWORD
from api.tests.test_invites import run_thread_now
from classification.models import CLASSIFICATION_DONE, Classification, Plugin, PluginVersion, Post, PostJudgment, UserPlugin
from classification.tests.helpers import create_verified_user
from feedback.models import Feedback

OWNER_EMAIL = 'owner@example.com'


def signed_in_client(user, method):
    client = Client()
    client.force_login(user)
    session = client.session
    session[SIGN_IN_METHOD_SESSION_KEY] = method
    session.save()
    return client


@override_settings(LOCAL_AUTH_BYPASS=False, ADMIN_EMAIL=OWNER_EMAIL, GIT_COMMIT='abc1234')
class InboxTests(TestCase):
    def setUp(self):
        self.owner = create_verified_user(OWNER_EMAIL)
        self.owner_client = signed_in_client(self.owner, SIGN_IN_GOOGLE)
        self.reader = create_verified_user('reader@example.com')

        plugin = Plugin.objects.create(slug='shouting', name='Shouting', description='All caps posts.')
        self.plugin_version = PluginVersion.objects.create(
            plugin=plugin, version=1, rubric_prompt='Judge shouting.', allowed_labels=['caps', 'insult'],
            criteria=[
                {'name': 'caps', 'question': 'Is it written in capitals?', 'points': 60},
                {'name': 'insult', 'question': 'Does it insult someone?', 'points': 40},
            ])
        UserPlugin.objects.create(user=self.reader, plugin=plugin, threshold=50)
        self.post = Post.objects.create(
            platform='x', post_id='185', kind='post', url='https://x.com/someone/status/185',
            author='someone', text='STOP SCROLLING', image_urls=['https://pbs.twimg.com/media/a.jpg'])
        self.post.images.create(source_url='https://pbs.twimg.com/media/a.jpg')
        self.classification = Classification.objects.create(
            post=self.post, plugin_version=self.plugin_version, status=CLASSIFICATION_DONE, score=60,
            label='caps', reasoning='Written in capitals.', criteria_met=['caps'], model='test-model')

        self.feedback = Feedback.objects.create(
            user=self.reader, source='extension', platform='x', post_id='185', shown_action='allow',
            expected_action='hide', text='Missed this one', site_commit='abc1234', extension_commit='ext1')
        self.judgment = PostJudgment.objects.create(
            user=self.reader, post=self.post, verdict='wrong', shown_action='hide', should_be='blocked', plugin=plugin,
            severity='high', details='This is fine, just loud.', extension_commit='ext2',
            filter_results=[{
                'plugin': 'shouting', 'version': 1, 'threshold': 50, 'flagged_action': 'hide',
                'classification_id': self.classification.id, 'status': 'done', 'score': 60,
                'label': 'caps', 'flagged': True,
            }])

    def items_by_id(self, client, status='open'):
        response = client.get(reverse('list_inbox'), {'status': status})
        self.assertEqual(response.status_code, 200)
        return {item['id']: item for item in response.json()['items']}

    def test_everyone_but_the_owner_signed_in_with_google_is_refused(self):
        staff = create_verified_user('staff@example.com')
        staff.is_staff = True
        staff.is_superuser = True
        staff.save()
        refused_clients = [
            Client(),
            signed_in_client(self.reader, SIGN_IN_GOOGLE),
            signed_in_client(staff, SIGN_IN_GOOGLE),
            signed_in_client(self.owner, SIGN_IN_PASSWORD),
        ]
        for client in refused_clients:
            self.assertEqual(client.get(reverse('list_inbox')).status_code, 403)
            self.assertEqual(client.get(reverse('inbox_item', args=[f'feedback-{self.feedback.id}'])).status_code, 403)
            self.assertEqual(client.get(reverse('list_thumbs')).status_code, 403)
            response = client.post(
                reverse('resolve_inbox_item', args=[f'feedback-{self.feedback.id}']), {'note': 'x'},
                content_type='application/json')
            self.assertEqual(response.status_code, 403)
        self.feedback.refresh_from_db()
        self.assertFalse(self.feedback.resolved)

    def test_the_inbox_lists_feedback_and_judgments_newest_first(self):
        response = self.owner_client.get(reverse('list_inbox'))
        item_ids = [item['id'] for item in response.json()['items']]
        self.assertEqual(item_ids, [f'judgment-{self.judgment.id}', f'feedback-{self.feedback.id}'])

    def test_a_judgment_comes_with_its_post_media_and_every_filters_criteria(self):
        item = self.items_by_id(self.owner_client)[f'judgment-{self.judgment.id}']

        self.assertEqual(item['sender'], {'email': 'reader@example.com', 'signed_in': True, 'name': ''})
        self.assertEqual(item['verdict'], 'wrong')
        self.assertEqual(item['details'], 'This is fine, just loud.')
        self.assertEqual((item['should_be'], item['plugin']), ('blocked', 'shouting'))
        self.assertEqual(item['extension_commit'], 'ext2')
        self.assertEqual(item['post']['text'], 'STOP SCROLLING')
        self.assertEqual(item['post']['url'], 'https://x.com/someone/status/185')
        self.assertEqual(item['post']['images'][0]['source_url'], 'https://pbs.twimg.com/media/a.jpg')
        shouting = item['filters'][0]
        self.assertEqual(shouting['score'], 60)
        self.assertEqual(shouting['threshold'], 50)
        self.assertTrue(shouting['flagged'])
        self.assertEqual(shouting['reasoning'], 'Written in capitals.')
        self.assertEqual(shouting['model'], 'test-model')
        self.assertEqual(shouting['criteria'], [
            {'name': 'caps', 'question': 'Is it written in capitals?', 'points': 60, 'met': True},
            {'name': 'insult', 'question': 'Does it insult someone?', 'points': 40, 'met': False},
        ])

    def test_feedback_about_a_post_shows_what_the_senders_filters_decide(self):
        item = self.items_by_id(self.owner_client)[f'feedback-{self.feedback.id}']

        self.assertEqual(item['text'], 'Missed this one')
        self.assertEqual(item['site_commit'], 'abc1234')
        self.assertEqual(item['extension_commit'], 'ext1')
        self.assertEqual(item['post']['post_id'], '185')
        self.assertEqual(item['filters'][0]['plugin'], 'shouting')
        self.assertEqual(item['filters'][0]['criteria'][0]['met'], True)

    def test_one_item_opens_by_its_id(self):
        response = self.owner_client.get(reverse('inbox_item', args=[f'feedback-{self.feedback.id}']))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['text'], 'Missed this one')
        self.assertEqual(self.owner_client.get(reverse('inbox_item', args=['feedback-99999'])).status_code, 404)
        self.assertEqual(self.owner_client.get(reverse('inbox_item', args=['nothing-1'])).status_code, 404)

    def test_resolving_records_the_commit_and_note_and_moves_the_item_out_of_open(self):
        for item_id in [f'feedback-{self.feedback.id}', f'judgment-{self.judgment.id}']:
            response = self.owner_client.post(
                reverse('resolve_inbox_item', args=[item_id]),
                {'commit': 'def5678', 'note': 'Threshold raised'}, content_type='application/json')
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()['resolved'])
            self.assertEqual(response.json()['resolved_commit'], 'def5678')

        self.assertEqual(self.items_by_id(self.owner_client), {})
        resolved = self.items_by_id(self.owner_client, 'resolved')
        self.assertEqual(resolved[f'judgment-{self.judgment.id}']['resolved_note'], 'Threshold raised')
        self.feedback.refresh_from_db()
        self.assertEqual(self.feedback.resolved_commit, 'def5678')

    def test_resolving_needs_no_note(self):
        for item_id in [f'feedback-{self.feedback.id}', f'judgment-{self.judgment.id}']:
            response = self.owner_client.post(
                reverse('resolve_inbox_item', args=[item_id]), {}, content_type='application/json')
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()['resolved'])
            self.assertEqual(response.json()['resolved_note'], '')
        self.assertEqual(self.items_by_id(self.owner_client), {})

    def test_a_thumbs_without_a_note_is_listed_with_the_thumbs_not_in_the_inbox(self):
        quiet_post = Post.objects.create(platform='x', post_id='186', kind='post', url='https://x.com/someone/status/186',
                                         author='someone', text='quiet post')
        quiet_judgment = PostJudgment.objects.create(
            user=self.reader, post=quiet_post, verdict='right', shown_action='allow', should_be='shown',
            filter_results=[{
                'plugin': 'shouting', 'version': 1, 'threshold': 50, 'flagged_action': 'hide',
                'classification_id': None, 'status': 'done', 'score': 10, 'label': '', 'flagged': False,
            }])

        self.assertNotIn(f'judgment-{quiet_judgment.id}', self.items_by_id(self.owner_client, 'all'))
        response = self.owner_client.get(reverse('list_thumbs'))
        self.assertEqual(response.status_code, 200)
        thumbs = response.json()['thumbs']
        self.assertEqual([row['id'] for row in thumbs], [f'judgment-{quiet_judgment.id}', f'judgment-{self.judgment.id}'])
        self.assertEqual(thumbs[0]['verdict'], 'right')
        self.assertEqual(thumbs[0]['post']['text'], 'quiet post')
        self.assertEqual(thumbs[0]['filters'][0]['score'], 10)
        self.assertEqual((thumbs[1]['should_be'], thumbs[1]['plugin']), ('blocked', 'shouting'))
        self.assertEqual(thumbs[1]['details'], 'This is fine, just loud.')

    def test_an_old_blur_judgment_reads_as_hidden(self):
        PostJudgment.objects.filter(id=self.judgment.id).update(
            shown_action='blur', filter_results=[{**self.judgment.filter_results[0], 'flagged_action': 'blur'}])

        item = self.items_by_id(self.owner_client)[f'judgment-{self.judgment.id}']
        self.assertEqual(item['shown_action'], 'hide')
        self.assertEqual(item['filters'][0]['flagged_action'], 'hide')
        thumb = self.owner_client.get(reverse('list_thumbs')).json()['thumbs'][0]
        self.assertEqual(thumb['shown_action'], 'hide')
        self.assertEqual(thumb['filters'][0]['flagged_action'], 'hide')

    def test_items_from_a_deleted_account_stay_without_their_sender(self):
        self.reader.delete()

        items = self.items_by_id(self.owner_client)
        judgment_item = items[f'judgment-{self.judgment.id}']
        self.assertEqual(judgment_item['sender'], {'email': '', 'signed_in': False, 'name': ''})
        self.assertEqual(judgment_item['details'], 'This is fine, just loud.')
        self.assertEqual(judgment_item['filters'][0]['score'], 60)
        feedback_item = items[f'feedback-{self.feedback.id}']
        self.assertEqual(feedback_item['sender'], {'email': '', 'signed_in': False, 'name': ''})
        self.assertEqual(feedback_item['text'], 'Missed this one')
        thumbs = self.owner_client.get(reverse('list_thumbs')).json()['thumbs']
        self.assertEqual(thumbs[0]['sender'], {'email': '', 'signed_in': False, 'name': ''})
        listed = json.loads(self.run_command('list_inbox'))['items']
        self.assertEqual({item['id'] for item in listed}, set(items))

    def test_the_session_says_whether_the_inbox_opens(self):
        self.assertTrue(self.owner_client.get(reverse('current_session')).json()['can_open_inbox'])
        password_owner = signed_in_client(self.owner, SIGN_IN_PASSWORD)
        self.assertFalse(password_owner.get(reverse('current_session')).json()['can_open_inbox'])
        reader_client = signed_in_client(self.reader, SIGN_IN_GOOGLE)
        self.assertFalse(reader_client.get(reverse('current_session')).json()['can_open_inbox'])

    def test_a_judgment_the_reader_changes_after_it_was_resolved_is_open_again(self):
        self.owner_client.post(
            reverse('resolve_inbox_item', args=[f'judgment-{self.judgment.id}']), {'note': 'Fine as it is'},
            content_type='application/json')
        self.assertNotIn(f'judgment-{self.judgment.id}', self.items_by_id(self.owner_client))

        self.judgment.details = 'Actually it insults me.'
        self.judgment.save()

        reopened = self.items_by_id(self.owner_client)[f'judgment-{self.judgment.id}']
        self.assertFalse(reopened['resolved'])

    def run_command(self, *arguments):
        output = StringIO()
        call_command(*arguments, stdout=output)
        return output.getvalue()

    def test_agents_read_the_same_items_as_json_and_resolve_them(self):
        listed = json.loads(self.run_command('list_inbox'))['items']
        self.assertEqual(listed, self.owner_client.get(reverse('list_inbox')).json()['items'])

        self.run_command('resolve_inbox', f'feedback-{self.feedback.id}', f'judgment-{self.judgment.id}',
                         '--commit', 'def5678', '--note', 'Rubric v2')
        self.assertEqual(json.loads(self.run_command('list_inbox'))['items'], [])
        everything = json.loads(self.run_command('list_inbox', '--status', 'all'))['items']
        self.assertEqual({item['resolved_note'] for item in everything}, {'Rubric v2'})

    def test_resolve_inbox_needs_no_note(self):
        self.run_command('resolve_inbox', f'feedback-{self.feedback.id}')
        self.feedback.refresh_from_db()
        self.assertTrue(self.feedback.resolved)
        self.assertEqual(self.feedback.resolved_note, '')

    def test_resolve_inbox_changes_nothing_when_an_id_is_unknown(self):
        with self.assertRaises(CommandError):
            self.run_command('resolve_inbox', f'feedback-{self.feedback.id}', 'judgment-99999', '--note', 'x')
        self.feedback.refresh_from_db()
        self.assertFalse(self.feedback.resolved)


@override_settings(GIT_COMMIT='abc1234', ADMIN_EMAIL=OWNER_EMAIL, FRONTEND_BASE_URL='https://brainrotindex.com')
class ContactFormTests(TestCase):
    def send(self, body, client=None):
        client = client or self.client
        with patch('api.emails.threading.Thread', side_effect=run_thread_now):
            return client.post(reverse('create_contact_message'), body, content_type='application/json')

    def test_a_message_is_stored_in_the_inbox_and_emailed_with_reply_to_the_sender(self):
        response = self.send({
            'name': 'Sam', 'email': 'sam@example.com', 'subject': 'Press question', 'message': 'Can we talk?'})

        self.assertEqual(response.status_code, 201)
        feedback = Feedback.objects.get(id=response.json()['id'])
        self.assertEqual(feedback.source, 'contact')
        self.assertIsNone(feedback.user)
        self.assertEqual(feedback.name, 'Sam')
        self.assertEqual(feedback.reply_email, 'sam@example.com')
        self.assertEqual(feedback.subject, 'Press question')
        self.assertEqual(feedback.text, 'Can we talk?')
        self.assertEqual(feedback.site_commit, 'abc1234')

        alert = mail.outbox[0]
        self.assertEqual(alert.to, [OWNER_EMAIL])
        self.assertEqual(alert.reply_to, ['sam@example.com'])
        self.assertIn('Press question', alert.subject)
        self.assertIn('Name: Sam', alert.body)
        self.assertIn('Can we talk?', alert.body)
        self.assertIn(f'https://brainrotindex.com/inbox/feedback-{feedback.id}', alert.body)

    def test_the_name_is_optional(self):
        response = self.send({'email': 'sam@example.com', 'subject': 'Hi', 'message': 'Hello'})
        self.assertEqual(response.status_code, 201)

    def test_email_subject_and_message_are_required(self):
        for missing in ['email', 'subject', 'message']:
            body = {'email': 'sam@example.com', 'subject': 'Hi', 'message': 'Hello'}
            del body[missing]
            self.assertEqual(self.send(body).status_code, 400)
        self.assertEqual(self.send({'email': 'not an address', 'subject': 'Hi', 'message': 'Hello'}).status_code, 400)
        self.assertEqual(Feedback.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_a_signed_in_sender_is_answered_at_the_address_they_typed(self):
        user = create_verified_user('reader@example.com')
        client = Client()
        client.force_login(user)
        response = self.send({'email': 'other@example.com', 'subject': 'Hi', 'message': 'Hello'}, client)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Feedback.objects.get(id=response.json()['id']).user, user)
        self.assertEqual(mail.outbox[0].reply_to, ['other@example.com'])

    def test_a_failed_alert_is_logged_and_the_message_is_still_stored(self):
        with patch('api.emails.EmailMultiAlternatives.send', side_effect=RuntimeError('domain not verified')), \
                self.assertLogs('api.emails', level='ERROR') as logs:
            response = self.send({'email': 'sam@example.com', 'subject': 'Hi', 'message': 'Hello'})

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Feedback.objects.count(), 1)
        self.assertIn('feedback alert', logs.output[0])
