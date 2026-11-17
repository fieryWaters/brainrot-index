from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from api.models import UserProfile

User = get_user_model()


class Command(BaseCommand):
    help = "Marks accounts' email addresses verified, for accounts made before verification was required."

    def add_arguments(self, parser):
        parser.add_argument('emails', nargs='+', help="Account email addresses.")

    def handle(self, *args, **options):
        for email in options['emails']:
            user = User.objects.filter(email__iexact=email).first()
            if user is None:
                raise CommandError(f"No account with email {email}")
            UserProfile.objects.update_or_create(user=user, defaults={'email_verified': True})
            self.stdout.write(f"Marked {user.email} verified.")
