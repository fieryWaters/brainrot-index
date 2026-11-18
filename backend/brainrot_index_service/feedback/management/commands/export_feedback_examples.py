import json
from pathlib import Path

from django.core.management.base import BaseCommand

from classification.evaluation import DIFFICULTY_CLEAR, example_from_post, load_examples
from classification.models import ACTION_ALLOW, Plugin, Post
from feedback.models import Feedback


class Command(BaseCommand):
    help = ("Appends feedback reports about a post to an evaluation dataset (eval/feedback.jsonl), "
            "as source 'feedback' examples. Reports already in the file are skipped, so hand edits stay.")

    def add_arguments(self, parser):
        parser.add_argument('--output', required=True, help="Path to the feedback JSONL file.")

    def handle(self, *args, **options):
        output_path = Path(options['output'])
        images_dir = output_path.parent / 'images'
        exported_ids = set()
        if output_path.exists():
            exported_ids = {example['id'] for example in load_examples(output_path)}
        baseline_slugs = list(Plugin.objects.filter(is_baseline=True).order_by('id').values_list('slug', flat=True))

        new_examples = []
        reports_without_post = 0
        for feedback in Feedback.objects.exclude(post_id='').order_by('id'):
            example_id = f"feedback-{feedback.id}"
            if example_id in exported_ids:
                continue
            post = Post.objects.filter(platform=feedback.platform, post_id=feedback.post_id).first()
            if post is None:
                reports_without_post += 1
                continue
            new_examples.append(self.example_from_feedback(example_id, feedback, post, baseline_slugs, images_dir))

        with open(output_path, 'a', encoding='utf-8') as output_file:
            for example in new_examples:
                output_file.write(json.dumps(example) + '\n')

        needing_labels = sum(1 for example in new_examples if not example['expected'])
        self.stdout.write(f"Added {len(new_examples)} examples to {output_path} "
                          f"({needing_labels} need the plugin that should flag them filled in by hand); "
                          f"skipped {reports_without_post} reports whose post was never stored.")

    def example_from_feedback(self, example_id, feedback, post, baseline_slugs, images_dir):
        example = example_from_post(example_id, 'feedback', post, images_dir)
        example['feedback'] = {
            'shown_action': feedback.shown_action,
            'expected_action': feedback.expected_action,
            'text': feedback.text,
        }
        # "Should have been allowed" means no plugin should flag it. "Should have
        # been hidden" does not say which plugin, so that is left to a person.
        example['expected'] = {}
        if feedback.expected_action == ACTION_ALLOW:
            for slug in baseline_slugs:
                example['expected'][slug] = {
                    'flag': False,
                    'difficulty': DIFFICULTY_CLEAR,
                    'why': f"Reported as wrongly filtered: shown {feedback.shown_action or 'unknown'}, expected allow.",
                }
        return example
