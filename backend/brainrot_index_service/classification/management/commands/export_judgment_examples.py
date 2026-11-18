import json
from pathlib import Path

from django.core.management.base import BaseCommand

from classification.evaluation import DIFFICULTY_BORDERLINE, DIFFICULTY_CLEAR, example_from_post
from classification.models import ACTION_ALLOW, SEVERITY_LOW, VERDICT_RIGHT, PostJudgment


def expected_answers(judgment):
    """What each filter should have decided, as far as the verdict says. A
    filter missing from the result has no known answer."""
    if judgment.severity == SEVERITY_LOW:
        difficulty = DIFFICULTY_BORDERLINE
    else:
        difficulty = DIFFICULTY_CLEAR
    shown = judgment.shown_action == ACTION_ALLOW
    right = judgment.verdict == VERDICT_RIGHT
    why = f"Reader's thumbs {'up' if right else 'down'} on a post that was {judgment.shown_action}."
    if judgment.details:
        why += f" Reader said: {judgment.details}"

    expected = {}
    if right and shown:
        # Every filter that was on rightly let it through.
        for filter_result in judgment.filter_results:
            expected[filter_result['plugin']] = {'flag': False, 'difficulty': difficulty, 'why': why}
    elif right:
        # Every filter that flagged it was right to.
        for filter_result in judgment.filter_results:
            if filter_result['flagged']:
                expected[filter_result['plugin']] = {'flag': True, 'difficulty': difficulty, 'why': why}
    elif not shown:
        # Every filter that flagged it was wrong to.
        for filter_result in judgment.filter_results:
            if filter_result['flagged']:
                expected[filter_result['plugin']] = {'flag': False, 'difficulty': difficulty, 'why': why}
    elif judgment.plugin is not None:
        # Shown but should not have been: only the filter the reader named is known.
        expected[judgment.plugin.slug] = {'flag': True, 'difficulty': difficulty, 'why': why}
    return expected


class Command(BaseCommand):
    help = ("Writes readers' thumbs up and down on posts to an evaluation dataset (eval/judgments.jsonl), "
            "as source 'judgment' examples, so evaluate_plugins can score a new rubric version against them. "
            "The file is rewritten each time, so a judgment the reader changed is up to date.")

    def add_arguments(self, parser):
        parser.add_argument('--output', required=True, help="Path to the judgments JSONL file.")

    def handle(self, *args, **options):
        output_path = Path(options['output'])
        images_dir = output_path.parent / 'images'

        examples = []
        without_answers = 0
        for judgment in PostJudgment.objects.select_related('post', 'plugin').order_by('id'):
            expected = expected_answers(judgment)
            if not expected:
                without_answers += 1
                continue
            example = example_from_post(f"judgment-{judgment.id}", 'judgment', judgment.post, images_dir)
            example['judgment'] = {
                'verdict': judgment.verdict,
                'shown_action': judgment.shown_action,
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
                          f"skipped {without_answers} thumbs down on shown posts that name no filter.")
