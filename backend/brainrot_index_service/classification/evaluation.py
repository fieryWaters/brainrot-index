"""Scoring a model and rubric versions against the owner's thumbs, each of
which says what a filter should have decided about a stored post. Uses the
production prompt, post description and answer parsing, but never writes
the Post and Classification tables: the summary is printed, not saved."""

import math
import statistics

from django.conf import settings

from .inference import ask_model, build_messages, describe_stored_post, images_for_model
from .models import SEVERITY_LOW, SHOULD_BE_SHOWN, PostJudgment

# The threshold a new user starts with (UserPlugin.threshold).
DEFAULT_THRESHOLD = 60
SWEEP_THRESHOLDS = [20, 30, 40, 50, 60, 70, 80, 90]
WORST_MISSES_SHOWN = 10
DIFFICULTY_CLEAR = 'clear'
DIFFICULTY_BORDERLINE = 'borderline'


def owner_judgments():
    return PostJudgment.objects.filter(user__email__iexact=settings.ADMIN_EMAIL).select_related('post', 'plugin').order_by('id')


def label_text(judgment):
    """The thumbs' label in words: "should be shown", "should be blocked as low-effort"."""
    if judgment.should_be == SHOULD_BE_SHOWN:
        return "should be shown"
    if judgment.plugin is None:
        return "should be blocked as Other"
    return f"should be blocked as {judgment.plugin.slug}"


def expected_answer(judgment, plugin_slug):
    """What one filter should decide about a judged post, or None when the
    thumbs is not in that filter's test set. A post that should be shown
    should be allowed by every filter; a post blocked as this filter should
    be flagged by it. A post blocked as another filter, or as Other, says
    nothing about this one."""
    if judgment.severity == SEVERITY_LOW:
        difficulty = DIFFICULTY_BORDERLINE
    else:
        difficulty = DIFFICULTY_CLEAR
    why = f"Reader's label: {label_text(judgment)}."
    if judgment.details:
        why += f" Reader said: {judgment.details}"

    if judgment.should_be == SHOULD_BE_SHOWN:
        return {'flag': False, 'difficulty': difficulty, 'why': why}
    if judgment.plugin is not None and judgment.plugin.slug == plugin_slug:
        return {'flag': True, 'difficulty': difficulty, 'why': why}
    return None


def judged_examples(plugin_slugs):
    """One example for each of the owner's thumbs in the test set of any of
    these filters: {id, text, description, image_urls, expected}, expected
    being {plugin slug: expected answer}. The post is described exactly as
    the production worker describes it."""
    examples = []
    for judgment in owner_judgments():
        expected = {}
        for slug in plugin_slugs:
            answer = expected_answer(judgment, slug)
            if answer is not None:
                expected[slug] = answer
        if not expected:
            continue
        images_with_data = images_for_model(judgment.post)
        examples.append({
            'id': f"judgment-{judgment.id}",
            'text': judgment.post.text,
            'description': describe_stored_post(judgment.post, len(images_with_data)),
            'image_urls': [data_url for _, data_url in images_with_data],
            'expected': expected,
        })
    return examples


def classify_example(example, plugin_version, inference_source, model, explain=False):
    """One result record: the model's answer for one example and one plugin.
    With explain, it also holds the model's explanation of each criterion."""
    messages = build_messages(plugin_version, example['description'], example['image_urls'], explain)
    outcome = ask_model(messages, plugin_version, inference_source, model, explain)
    record = {
        'example_id': example['id'],
        'plugin': plugin_version.plugin.slug,
        'failed': outcome.answer is None,
        'score': None,
        'label': None,
        'reasoning': None,
        'criteria_met': None,
        'latency_ms': outcome.latency_ms,
        'prompt_tokens': outcome.prompt_tokens,
        'completion_tokens': outcome.completion_tokens,
        'cost': outcome.cost,
    }
    if outcome.answer is not None:
        record['score'] = outcome.answer['score']
        record['label'] = outcome.answer['label']
        record['reasoning'] = outcome.answer['reasoning']
        record['criteria_met'] = outcome.answer['criteria_met']
        if 'criteria_explanations' in outcome.answer:
            record['criteria_explanations'] = outcome.answer['criteria_explanations']
    return record


def percentile(sorted_values, fraction):
    """The nearest-rank percentile of an already sorted list."""
    rank = max(1, math.ceil(fraction * len(sorted_values)))
    return sorted_values[rank - 1]


def ratio_text(numerator, denominator):
    if denominator == 0:
        return '  n/a'
    return f"{numerator / denominator:5.2f}"


def counts_at_threshold(scored_cases, threshold):
    """(true positives, false positives, false negatives) for cases of
    (expected flag, score), where a score at or above the threshold flags."""
    true_positives = 0
    false_positives = 0
    false_negatives = 0
    for expected_flag, score in scored_cases:
        flagged = score >= threshold
        if flagged and expected_flag:
            true_positives += 1
        elif flagged and not expected_flag:
            false_positives += 1
        elif not flagged and expected_flag:
            false_negatives += 1
    return true_positives, false_positives, false_negatives


def precision_and_recall_text(scored_cases, threshold):
    true_positives, false_positives, false_negatives = counts_at_threshold(scored_cases, threshold)
    precision = ratio_text(true_positives, true_positives + false_positives)
    recall = ratio_text(true_positives, true_positives + false_negatives)
    return f"precision {precision}  recall {recall}"


def plugin_summary_lines(plugin_version, examples, records_by_key):
    slug = plugin_version.plugin.slug
    labeled_examples = [example for example in examples if slug in example.get('expected', {})]
    records = [records_by_key[(example['id'], slug)] for example in labeled_examples
               if (example['id'], slug) in records_by_key]
    failed_count = sum(1 for record in records if record['failed'])
    expected_flagged_count = sum(1 for example in labeled_examples if example['expected'][slug]['flag'])

    lines = [f"== {slug} v{plugin_version.version}: {len(labeled_examples)} examples, "
             f"{expected_flagged_count} expected flagged =="]
    if not records:
        lines.append("no results yet")
        return lines
    lines.append(f"failed or invalid: {failed_count} of {len(records)} ({100 * failed_count / len(records):.1f}%)")

    latencies = sorted(record['latency_ms'] for record in records if record['latency_ms'] is not None)
    if latencies:
        lines.append(f"latency: median {statistics.median(latencies):.0f} ms, p95 {percentile(latencies, 0.95)} ms")
    costs = [record['cost'] for record in records if record['cost'] is not None]
    if costs:
        lines.append(f"cost per classification: ${sum(costs) / len(costs):.6f} "
                     f"(total ${sum(costs):.4f} over {len(costs)} reported)")

    all_cases = []
    clear_cases = []
    missed_counts = {DIFFICULTY_CLEAR: 0, DIFFICULTY_BORDERLINE: 0}
    wrongly_flagged_counts = {DIFFICULTY_CLEAR: 0, DIFFICULTY_BORDERLINE: 0}
    for example in labeled_examples:
        record = records_by_key.get((example['id'], slug))
        if record is None or record['failed']:
            continue
        expected = example['expected'][slug]
        all_cases.append((expected['flag'], record['score']))
        if expected['difficulty'] == DIFFICULTY_CLEAR:
            clear_cases.append((expected['flag'], record['score']))
        flagged = record['score'] >= DEFAULT_THRESHOLD
        if expected['flag'] and not flagged:
            missed_counts[expected['difficulty']] += 1
        if flagged and not expected['flag']:
            wrongly_flagged_counts[expected['difficulty']] += 1

    lines.append(f"at threshold {DEFAULT_THRESHOLD}: all cases {precision_and_recall_text(all_cases, DEFAULT_THRESHOLD)}; "
                 f"clear cases {precision_and_recall_text(clear_cases, DEFAULT_THRESHOLD)}")
    for difficulty in [DIFFICULTY_CLEAR, DIFFICULTY_BORDERLINE]:
        missed = missed_counts[difficulty]
        wrongly_flagged = wrongly_flagged_counts[difficulty]
        lines.append(f"wrong {difficulty} answers: {missed + wrongly_flagged} "
                     f"({missed} missed, {wrongly_flagged} wrongly flagged)")

    lines.extend(criteria_lines(plugin_version, labeled_examples, records_by_key))

    lines.append("threshold sweep (all cases): threshold, precision, recall, missed, wrongly flagged")
    for threshold in SWEEP_THRESHOLDS:
        true_positives, false_positives, false_negatives = counts_at_threshold(all_cases, threshold)
        lines.append(f"  {threshold:3d}  {ratio_text(true_positives, true_positives + false_positives)}"
                     f"  {ratio_text(true_positives, true_positives + false_negatives)}"
                     f"  {false_negatives:4d}  {false_positives:4d}")
    return lines


def criteria_lines(plugin_version, labeled_examples, records_by_key):
    """How often each criterion was met on the examples that should be flagged
    and on those that should not: a criterion often met on posts that should
    stay is the one to rewrite."""
    if not plugin_version.criteria:
        return []
    slug = plugin_version.plugin.slug
    met_when_expected = {True: {}, False: {}}
    totals = {True: 0, False: 0}
    for example in labeled_examples:
        record = records_by_key.get((example['id'], slug))
        if record is None or record['failed']:
            continue
        expected_flag = example['expected'][slug]['flag']
        totals[expected_flag] += 1
        for name in record['criteria_met']:
            met_when_expected[expected_flag][name] = met_when_expected[expected_flag].get(name, 0) + 1

    lines = ["criteria: name (points), met on expected flagged, met on expected allowed"]
    for criterion in plugin_version.criteria:
        name = criterion['name']
        lines.append(f"  {name} ({criterion['points']}): {met_when_expected[True].get(name, 0)} of {totals[True]}, "
                     f"{met_when_expected[False].get(name, 0)} of {totals[False]}")
    return lines


def worst_misses_lines(plugin_versions, examples, records_by_key):
    """Clear cases answered wrongly at the default threshold, the most confidently wrong first."""
    misses = []
    for plugin_version in plugin_versions:
        slug = plugin_version.plugin.slug
        for example in examples:
            expected = example.get('expected', {}).get(slug)
            record = records_by_key.get((example['id'], slug))
            if expected is None or record is None or record['failed']:
                continue
            if expected['difficulty'] != DIFFICULTY_CLEAR:
                continue
            if (record['score'] >= DEFAULT_THRESHOLD) != expected['flag']:
                misses.append((abs(record['score'] - DEFAULT_THRESHOLD), slug, example, expected, record))
    misses.sort(key=lambda miss: miss[0], reverse=True)

    lines = [f"== worst misses on clear cases ({len(misses)} in all) =="]
    for _, slug, example, expected, record in misses[:WORST_MISSES_SHOWN]:
        expected_text = 'flag' if expected['flag'] else 'allow'
        lines.append(f"- {example['id']} [{slug}] expected {expected_text}, scored {record['score']} ({record['label']})")
        lines.append(f"  text: {example['text'][:200]}")
        lines.append(f"  expected because: {expected['why']}")
        lines.append(f"  model said: {record['reasoning']}")
        for name, explanation in record.get('criteria_explanations', {}).items():
            lines.append(f"    {name}: {explanation}")
    return lines
