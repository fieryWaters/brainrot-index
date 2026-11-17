from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from billing.models import Subscription


class Command(BaseCommand):
    help = 'Makes an account free forever (comp). --revoke makes it pay again.'

    def add_arguments(self, parser):
        parser.add_argument('email')
        parser.add_argument('--revoke', action='store_true')

    def handle(self, *args, **options):
        user = get_user_model().objects.filter(email__iexact=options['email']).first()
        if user is None:
            raise CommandError(f"No account with email {options['email']}")

        comp = not options['revoke']
        Subscription.objects.filter(user=user).update(comp=comp)
        if comp:
            self.stdout.write(f'{user.email} is now free forever.')
        else:
            self.stdout.write(f'{user.email} is no longer comp.')
