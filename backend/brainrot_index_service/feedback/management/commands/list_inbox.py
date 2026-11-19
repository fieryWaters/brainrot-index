import json

from django.core.management.base import BaseCommand

from feedback.inbox import STATUS_OPEN, STATUSES, inbox_items


class Command(BaseCommand):
    help = ("Prints the inbox as JSON, newest first: feedback reports, contact messages and readers' "
            "thumbs on posts, each with its post, media, every filter's score and criteria, and the "
            "commits it was written against. Open items only unless --status says otherwise.")

    def add_arguments(self, parser):
        parser.add_argument('--status', choices=STATUSES, default=STATUS_OPEN)

    def handle(self, *args, **options):
        self.stdout.write(json.dumps({'items': inbox_items(options['status'])}, indent=1))
