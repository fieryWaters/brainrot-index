from django.core.management.base import BaseCommand, CommandError

from feedback.inbox import UnknownItem, find_item, resolve_item


class Command(BaseCommand):
    help = "Marks inbox items resolved, such as feedback-12 or judgment-34, naming the commit that fixed them."

    def add_arguments(self, parser):
        parser.add_argument('item_ids', nargs='+', help="Inbox item ids, as list_inbox prints them.")
        parser.add_argument('--commit', default='', help="The commit that fixed the problem, if one did.")
        parser.add_argument('--note', required=True, help="What was wrong and what changed.")

    def handle(self, *args, **options):
        # Every id is checked before any is resolved, so a typo changes nothing.
        unknown_ids = []
        for item_id in options['item_ids']:
            try:
                find_item(item_id)
            except UnknownItem:
                unknown_ids.append(item_id)
        if unknown_ids:
            raise CommandError(f"No inbox item {', '.join(unknown_ids)}")

        for item_id in options['item_ids']:
            resolve_item(item_id, options['commit'], options['note'])
        self.stdout.write(f"Marked {len(options['item_ids'])} items resolved.")
