from datetime import timedelta

from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

from classification.models import UserSettings
from classification.tests.helpers import create_verified_user
from families.models import FamilyInvite, FamilyMember


def signed_in_client(email):
    user = create_verified_user(email)
    client = Client()
    client.force_login(user)
    return user, client


def post(client, name, body=None, args=None):
    return client.post(reverse(name, args=args), body or {}, content_type='application/json')


def patch(client, name, body, args=None):
    return client.patch(reverse(name, args=args), body, content_type='application/json')


class FamilyTestCase(TestCase):
    """A family made by parent, with helpers to invite and join."""

    def setUp(self):
        self.parent, self.parent_client = signed_in_client('parent@example.com')
        post(self.parent_client, 'family', {'name': 'The Smiths'})

    def invite(self, role):
        return post(self.parent_client, 'family_invites', {'role': role}).json()['code']

    def join(self, email, role):
        user, client = signed_in_client(email)
        response = post(client, 'family_join', {'code': self.invite(role)})
        self.assertEqual(response.status_code, 200)
        return user, client


class NoFamilyTests(TestCase):
    def test_a_user_with_no_family_is_their_own_superadmin(self):
        user, client = signed_in_client('solo@example.com')
        self.assertEqual(client.get(reverse('family')).json(), {'role': 'superadmin', 'family': None})
        self.assertEqual(patch(client, 'user_settings', {'mode': 'child'}).status_code, 200)
        self.assertEqual(patch(client, 'installed_plugin', {'threshold': 20}, args=['rude-or-toxic']).status_code, 200)


class CreateAndJoinTests(FamilyTestCase):
    def test_creator_is_superadmin(self):
        family = self.parent_client.get(reverse('family')).json()
        self.assertEqual(family['role'], 'superadmin')
        self.assertEqual(family['family']['members'], [
            {'user_id': self.parent.id, 'email': 'parent@example.com', 'role': 'superadmin', 'is_you': True},
        ])

    def test_invite_joins_with_the_chosen_role_and_is_single_use(self):
        code = self.invite('admin')
        adult, adult_client = signed_in_client('adult@example.com')
        preview = post(adult_client, 'family_invite_preview', {'code': code.lower()}).json()
        self.assertEqual(preview['family_name'], 'The Smiths')
        self.assertEqual(preview['role'], 'admin')

        self.assertEqual(post(adult_client, 'family_join', {'code': code}).status_code, 200)
        self.assertEqual(FamilyMember.objects.get(user=adult).role, 'admin')

        _, late_client = signed_in_client('late@example.com')
        self.assertEqual(post(late_client, 'family_join', {'code': code}).status_code, 400)

    def test_only_the_hash_of_the_code_is_stored(self):
        code = self.invite('admin')
        self.assertFalse(FamilyInvite.objects.filter(code_hash=code).exists())

    def test_expired_and_revoked_invites_do_not_work(self):
        expired_code = self.invite('admin')
        FamilyInvite.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        revoked_code = self.invite('admin')
        revoked_id = FamilyInvite.objects.latest('id').id
        post(self.parent_client, 'family_invite_revoke', args=[revoked_id])

        _, client = signed_in_client('someone@example.com')
        self.assertEqual(post(client, 'family_join', {'code': expired_code}).status_code, 400)
        self.assertEqual(post(client, 'family_join', {'code': revoked_code}).status_code, 400)

    def test_joining_as_child_turns_on_child_mode(self):
        child, _ = self.join('kid@example.com', 'child')
        user_settings = UserSettings.objects.get(user=child)
        self.assertEqual(user_settings.mode, 'child')
        self.assertFalse(user_settings.allow_reveal)

    def test_cannot_join_a_second_family(self):
        adult, adult_client = self.join('adult@example.com', 'admin')
        _, other_parent_client = signed_in_client('other@example.com')
        post(other_parent_client, 'family', {'name': 'The Joneses'})
        code = post(other_parent_client, 'family_invites', {'role': 'admin'}).json()['code']
        self.assertEqual(post(adult_client, 'family_join', {'code': code}).status_code, 400)
        self.assertEqual(post(adult_client, 'family', {'name': 'Another'}).status_code, 400)


class RoleRuleTests(FamilyTestCase):
    def test_only_a_superadmin_invites_or_changes_roles(self):
        adult, adult_client = self.join('adult@example.com', 'admin')
        self.assertEqual(post(adult_client, 'family_invites', {'role': 'superadmin'}).status_code, 403)
        self.assertEqual(
            patch(adult_client, 'family_member', {'role': 'superadmin'}, args=[adult.id]).status_code, 403)

    def test_last_superadmin_cannot_be_demoted(self):
        self.join('adult@example.com', 'admin')
        response = patch(self.parent_client, 'family_member', {'role': 'admin'}, args=[self.parent.id])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(FamilyMember.objects.get(user=self.parent).role, 'superadmin')

    def test_a_superadmin_can_step_down_once_another_exists(self):
        adult, _ = self.join('adult@example.com', 'admin')
        patch(self.parent_client, 'family_member', {'role': 'superadmin'}, args=[adult.id])
        response = patch(self.parent_client, 'family_member', {'role': 'admin'}, args=[self.parent.id])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['role'], 'admin')

    def test_last_superadmin_cannot_leave_while_others_remain(self):
        self.join('adult@example.com', 'admin')
        self.assertEqual(post(self.parent_client, 'family_leave').status_code, 400)

    def test_last_member_can_leave(self):
        response = post(self.parent_client, 'family_leave')
        self.assertEqual(response.json(), {'role': 'superadmin', 'family': None})

    def test_child_cannot_leave_but_can_be_removed(self):
        child, child_client = self.join('kid@example.com', 'child')
        self.assertEqual(post(child_client, 'family_leave').status_code, 403)
        self.assertEqual(self.parent_client.delete(reverse('family_member', args=[child.id])).status_code, 200)
        self.assertEqual(child_client.get(reverse('family')).json()['family'], None)

    def test_demoting_to_child_turns_on_child_mode(self):
        adult, _ = self.join('adult@example.com', 'admin')
        patch(self.parent_client, 'family_member', {'role': 'child'}, args=[adult.id])
        self.assertEqual(UserSettings.objects.get(user=adult).mode, 'child')


class MemberSettingsTests(FamilyTestCase):
    def test_superadmin_changes_a_members_settings_and_plugins(self):
        child, _ = self.join('kid@example.com', 'child')
        response = patch(self.parent_client, 'member_settings', {'allow_reveal': True}, args=[child.id])
        self.assertEqual(response.status_code, 200)
        response = patch(self.parent_client, 'member_plugin', {'threshold': 25}, args=[child.id, 'rude-or-toxic'])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['threshold'], 25)

        response = self.parent_client.delete(reverse('member_plugin', args=[child.id, 'rude-or-toxic']))
        self.assertEqual(response.status_code, 204)
        response = post(self.parent_client, 'member_plugins', {'slug': 'rude-or-toxic'}, args=[child.id])
        self.assertEqual(response.status_code, 201)

    def test_admin_changes_only_their_own_settings(self):
        adult, adult_client = self.join('adult@example.com', 'admin')
        self.assertEqual(patch(adult_client, 'user_settings', {'mode': 'child'}).status_code, 200)
        self.assertEqual(
            patch(adult_client, 'installed_plugin', {'threshold': 30}, args=['rude-or-toxic']).status_code, 200)

        self.assertEqual(
            patch(adult_client, 'member_settings', {'mode': 'child'}, args=[self.parent.id]).status_code, 404)
        self.assertEqual(
            patch(adult_client, 'member_plugin', {'threshold': 1}, args=[self.parent.id, 'rude-or-toxic']).status_code, 404)
        self.assertEqual(adult_client.get(reverse('member_settings', args=[self.parent.id])).status_code, 404)

    def test_child_sees_but_cannot_change_their_settings(self):
        child, child_client = self.join('kid@example.com', 'child')
        self.assertEqual(child_client.get(reverse('user_settings')).status_code, 200)
        plugins = child_client.get(reverse('installed_plugins')).json()
        self.assertFalse(plugins['can_change'])

        for change in [{'mode': 'adult'}, {'allow_reveal': True}, {'enabled': False}]:
            self.assertEqual(patch(child_client, 'user_settings', change).status_code, 403)
        self.assertEqual(patch(child_client, 'installed_plugin', {'threshold': 99}, args=['rude-or-toxic']).status_code, 403)
        self.assertEqual(patch(child_client, 'installed_plugin', {'enabled': False}, args=['rude-or-toxic']).status_code, 403)
        self.assertEqual(UserSettings.objects.get(user=child).mode, 'child')

    def test_superadmin_cannot_reach_someone_outside_the_family(self):
        stranger, _ = signed_in_client('stranger@example.com')
        self.assertEqual(
            patch(self.parent_client, 'member_settings', {'mode': 'child'}, args=[stranger.id]).status_code, 404)
        self.assertEqual(
            patch(self.parent_client, 'family_member', {'role': 'child'}, args=[stranger.id]).status_code, 404)
