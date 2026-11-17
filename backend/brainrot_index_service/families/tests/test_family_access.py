from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from billing.access import account_has_access
from billing.models import STATUS_ACTIVE, Subscription
from classification.tests.helpers import create_verified_user
from families.models import Family, FamilyMember


def end_trial(user):
    Subscription.objects.filter(user=user).update(trial_end=timezone.now() - timedelta(days=1))


def subscribe(user):
    Subscription.objects.filter(user=user).update(
        status=STATUS_ACTIVE,
        stripe_subscription_id=f'sub_{user.id}',
        current_period_end=timezone.now() + timedelta(days=20),
    )


class FamilyAccessTests(TestCase):
    def setUp(self):
        self.payer = create_verified_user('payer@example.com')
        self.child = create_verified_user('kid@example.com')
        self.family = Family.objects.create(name='The Smiths', created_by=self.payer)
        FamilyMember.objects.create(user=self.payer, family=self.family, role='superadmin')
        FamilyMember.objects.create(user=self.child, family=self.family, role='child')
        end_trial(self.child)

    def test_a_member_is_covered_by_a_paying_superadmin(self):
        end_trial(self.payer)
        self.assertFalse(account_has_access(self.child))
        subscribe(self.payer)
        self.assertTrue(account_has_access(self.child))

    def test_a_superadmins_trial_covers_the_family(self):
        self.assertTrue(account_has_access(self.child))

    def test_a_paying_admin_does_not_cover_the_family(self):
        end_trial(self.payer)
        adult = create_verified_user('adult@example.com')
        FamilyMember.objects.create(user=adult, family=self.family, role='admin')
        subscribe(adult)
        self.assertTrue(account_has_access(adult))
        self.assertFalse(account_has_access(self.child))

    def test_leaving_the_family_ends_the_cover(self):
        FamilyMember.objects.filter(user=self.child).delete()
        self.assertFalse(account_has_access(self.child))
