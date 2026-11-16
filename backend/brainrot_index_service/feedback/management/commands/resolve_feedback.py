from django.core.management.base import BaseCommand, CommandError

from feedback.models import Feedback


class Command(BaseCommand):
    help = "Marks feedback reports resolved, naming the commit that fixed them."

    def add_arguments(self, parser):
        parser.add_argument('ids', nargs='+', type=int, help="Feedback ids.")
        parser.add_argument('--commit', required=True, help="The commit that fixed the problem.")
        parser.add_argument('--note', required=True, help="What was wrong and what changed.")

    def handle(self, *args, **options):
        reports = Feedback.objects.filter(id__in=options['ids'])
        missing_ids = set(options['ids']) - set(reports.values_list('id', flat=True))
        if missing_ids:
            raise CommandError(f"No feedback with id {sorted(missing_ids)}")
        reports.update(resolved=True, resolved_commit=options['commit'], resolved_note=options['note'])
        self.stdout.write(f"Marked {len(options['ids'])} reports resolved in {options['commit']}.")
