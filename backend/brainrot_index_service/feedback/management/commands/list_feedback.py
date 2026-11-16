from django.core.management.base import BaseCommand

from feedback.models import Feedback


class Command(BaseCommand):
    help = "Prints feedback reports that are not resolved yet, oldest first. --all prints every report."

    def add_arguments(self, parser):
        parser.add_argument('--all', action='store_true', help="Include resolved reports.")

    def handle(self, *args, **options):
        reports = Feedback.objects.select_related('user').order_by('id')
        if not options['all']:
            reports = reports.filter(resolved=False)

        for feedback in reports:
            sender = feedback.user.email if feedback.user is not None else 'not signed in'
            self.stdout.write(f"#{feedback.id}  {feedback.created_at:%Y-%m-%d %H:%M}  {feedback.source}  {sender}")
            self.stdout.write(f"  page: {feedback.page_url}")
            self.stdout.write(f"  site commit: {feedback.site_commit}  extension commit: {feedback.extension_commit}")
            if feedback.post_id:
                self.stdout.write(f"  post: {feedback.platform} {feedback.post_id}  "
                                  f"shown: {feedback.shown_action}  expected: {feedback.expected_action}")
            elif feedback.expected_action:
                self.stdout.write(f"  expected: {feedback.expected_action}")
            if feedback.text:
                self.stdout.write(f"  text: {feedback.text}")
            if feedback.resolved:
                self.stdout.write(f"  resolved in {feedback.resolved_commit}: {feedback.resolved_note}")
            self.stdout.write("")
        self.stdout.write(f"{reports.count()} reports")
