from django.core.management.base import BaseCommand

from api.models import InviteCode


class Command(BaseCommand):
    help = "Creates an invite code for new accounts and prints it."

    def add_arguments(self, parser):
        parser.add_argument('--note', required=True, help="Who the code is for.")
        parser.add_argument('--max-uses', type=int, default=1, help="How many accounts may sign up with it.")

    def handle(self, *args, **options):
        invite = InviteCode.objects.create(note=options['note'], max_uses=options['max_uses'])
        self.stdout.write(invite.code)
