import json
from collections import Counter
from pathlib import Path

from django.core.management.base import BaseCommand

from classification.evaluation import example_from_post, expected_answer
from classification.models import VERDICT_RIGHT, VERDICT_WRONG, Plugin, PostJudgment


def filter_count_lines(examples):
    """How many test cases each filter has, split by the reader's verdict and
    by the expected answer."""
    counts = {}
    for example in examples:
        verdict = example['judgment']['verdict']
        for slug, answer in example['expected'].items():
            if slug not in counts:
                counts[slug] = Counter()
            counts[slug]['cases'] += 1
            counts[slug][verdict] += 1
            if answer['flag']:
                counts[slug]['should flag'] += 1
            else:
                counts[slug]['should not flag'] += 1

    lines = ['Test cases by filter:']
    for slug in sorted(counts):
        count = counts[slug]
        lines.append(f"  {slug}: {count['cases']} cases; "
                     f"{count[VERDICT_RIGHT]} thumbs up, {count[VERDICT_WRONG]} thumbs down; "
                     f"{count['should flag']} should flag, {count['should not flag']} should not flag")
    return lines


class Command(BaseCommand):
    help = ("Writes readers' thumbs up and down on posts to an evaluation dataset (eval/judgments.jsonl), "
            "as source 'judgment' examples, so evaluate_plugins can score a new rubric version against them, "
            "and prints how many test cases each filter has. A post labeled should be shown is a case for "
            "every default filter; a post labeled should be blocked as a filter is a case for that filter only. "
            "The file is rewritten each time, so a judgment the reader changed is up to date.")

    def add_arguments(self, parser):
        parser.add_argument('--output', required=True, help="Path to the judgments JSONL file.")

    def handle(self, *args, **options):
        output_path = Path(options['output'])
        images_dir = output_path.parent / 'images'

        default_slugs = list(Plugin.objects.filter(is_baseline=True).order_by('id').values_list('slug', flat=True))
        examples = []
        without_answers = 0
        for judgment in PostJudgment.objects.select_related('post', 'plugin').order_by('id'):
            slugs = list(default_slugs)
            if judgment.plugin is not None and judgment.plugin.slug not in slugs:
                slugs.append(judgment.plugin.slug)
            expected = {}
            for slug in slugs:
                answer = expected_answer(judgment, slug)
                if answer is not None:
                    expected[slug] = answer
            if not expected:
                without_answers += 1
                continue
            example = example_from_post(f"judgment-{judgment.id}", 'judgment', judgment.post, images_dir)
            example['judgment'] = {
                'verdict': judgment.verdict,
                'shown_action': judgment.shown_action,
                'should_be': judgment.should_be,
                'severity': judgment.severity,
                'details': judgment.details,
                'filter_results': judgment.filter_results,
            }
            example['expected'] = expected
            examples.append(example)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as output_file:
            for example in examples:
                output_file.write(json.dumps(example) + '\n')
        self.stdout.write(f"Wrote {len(examples)} examples to {output_path}; "
                          f"skipped {without_answers} thumbs blocked as Other.")
        self.stdout.write('\n'.join(filter_count_lines(examples)))
