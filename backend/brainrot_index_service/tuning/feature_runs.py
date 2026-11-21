"""Running a feature set experiment: rating each post once on every feature
of the draft, then deciding every filter from those ratings, beside each
filter's live version.

A filter's test set is the owner's thumbs labeled should be shown (should
allow) and those labeled should be blocked as that filter (should flag),
and, when asked for, the synthetic test set's examples for that filter. A
post is a case once, for every filter whose test set holds it.

The live answer of a filter on a thumbs is production's own stored
classification by the live version when there is one, then one from an
earlier experiment with the same live version and model; only otherwise is
the live version asked. Explanations, like the rubric experiments', are
asked afterwards in a follow-up turn, so they never change the ratings.

The background worker and the run_feature_experiment command share this code."""

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings
from django.utils import timezone

from classification.evaluation import expected_answer, load_examples
from classification.features import ask_feature_scores, features_prompt, filter_score
from classification.inference import ask_model, build_messages, chat_messages, configured_model
from classification.models import CLASSIFICATION_DONE, PLUGIN_INPUT_VIDEO, Classification, Plugin, PluginVersion

from .models import EXPERIMENT_DONE, EXPERIMENT_RUNNING, FeatureExperiment, FeatureResult, TuningResult
from .runs import (
    MODEL_CALLS_AT_ONCE,
    Usage,
    answer_record,
    claim_next,
    owner_judgments,
    request_explanations,
    run_or_mark_failed,
    synthetic_fields,
    thumb_fields,
    video_was_watched,
)

logger = logging.getLogger(__name__)

FEATURE_EXPLANATION_REQUEST = """\
For each feature, explain in one or two sentences why you gave the rating you
did in your answer above. Answer with a JSON object with one field per
feature, named as above, holding its explanation."""

COUNT_NAMES = ['right', 'missed', 'wrongly_flagged', 'failed']


@dataclass
class FeatureCase:
    """One post to rate, with what each filter whose test set holds it should decide."""

    case_id: str
    source: str
    expected: dict
    owner: dict
    description: str
    post: dict
    image_data_urls: list
    image_urls: list = field(default_factory=list)
    post_url: str = ''
    judgment: object = None
    video_not_watched: bool = False


def live_versions(filters):
    """Each filter's live version and cutoff: {plugin slug: {version_id, version, threshold}}."""
    live = {}
    for filter_definition in filters:
        plugin = Plugin.objects.get(slug=filter_definition['plugin'])
        live_version = plugin.latest_version()
        live[plugin.slug] = {'version_id': live_version.id, 'version': live_version.version,
                             'threshold': plugin.default_threshold}
    return live


def create_experiment(features, filters, include_synthetic=False, explain_every_case=False,
                      started_from_feature_set=None, started_from=None, status=None):
    """A new experiment with production's model and the filters' live versions
    as they are now. status running keeps the worker from taking it up, for a
    run in this process."""
    experiment = FeatureExperiment(
        started_from_feature_set=started_from_feature_set,
        started_from=started_from,
        features=features,
        filters=filters,
        live=live_versions(filters),
        include_synthetic=include_synthetic,
        explain_every_case=explain_every_case,
        model=configured_model(),
        inference_source=settings.INFERENCE_SOURCE,
    )
    if status is not None:
        experiment.status = status
        experiment.heartbeat_at = timezone.now()
    experiment.save()
    return experiment


def synthetic_examples_for_any(slugs):
    """The synthetic test set's examples with an answer for any of these
    filters; none when the test set is not where the settings say."""
    dataset_path = Path(settings.TUNING_SYNTHETIC_DATASET)
    if not dataset_path.exists():
        return []
    return [example for example in load_examples(dataset_path)
            if any(slug in example.get('expected', {}) for slug in slugs)]


def thumbs_expected(slugs):
    """(judgment, {slug: should flag}) for each of the owner's thumbs in the test set of any of these filters."""
    found = []
    for judgment in owner_judgments():
        expected = {}
        for slug in slugs:
            answer = expected_answer(judgment, slug)
            if answer is not None:
                expected[slug] = answer['flag']
        if expected:
            found.append((judgment, expected))
    return found


def experiment_cases(experiment):
    slugs = [filter_definition['plugin'] for filter_definition in experiment.filters]
    watching = set(Plugin.objects.filter(slug__in=slugs, input_kind=PLUGIN_INPUT_VIDEO).values_list('slug', flat=True))
    cases = []
    for judgment, expected in thumbs_expected(slugs):
        video_not_watched = bool(watching.intersection(expected)) and video_was_watched(judgment.post)
        cases.append(FeatureCase(expected=expected, video_not_watched=video_not_watched, **thumb_fields(judgment)))
    if experiment.include_synthetic:
        for example in synthetic_examples_for_any(slugs):
            expected = {slug: example['expected'][slug]['flag'] for slug in slugs if slug in example['expected']}
            why = {slug: example['expected'][slug]['why'] for slug in expected}
            cases.append(FeatureCase(expected=expected, owner={'why': why}, **synthetic_fields(example)))
    return cases


def known_live_answers(experiment, cases):
    """The live answers that need no model call, by (case id, plugin slug):
    production's stored classification of a thumbs' post by the live
    version, then an earlier rubric or feature experiment's answer with the
    same live version and model, on a post that reads the same."""
    known = {}
    for case in cases:
        if case.judgment is None:
            continue
        for slug in case.expected:
            classification = Classification.objects.filter(
                post=case.judgment.post, plugin_version_id=experiment.live[slug]['version_id'],
                status=CLASSIFICATION_DONE).first()
            if classification is not None:
                known[(case.case_id, slug)] = {
                    'failed': False, 'score': classification.score,
                    'criteria_met': classification.criteria_met, 'reasoning': classification.reasoning,
                }

    descriptions = {case.case_id: case.description for case in cases}
    version_slugs = {live['version_id']: slug for slug, live in experiment.live.items()}
    rubric_results = TuningResult.objects.filter(
        experiment__live_version_id__in=list(version_slugs), experiment__model=experiment.model,
        experiment__inference_source=experiment.inference_source, case_id__in=list(descriptions),
    ).select_related('experiment').order_by('id')
    for result in rubric_results:
        key = (result.case_id, version_slugs[result.experiment.live_version_id])
        if not result.live['failed'] and result.description == descriptions[result.case_id]:
            known.setdefault(key, result.live)

    feature_results = FeatureResult.objects.filter(
        experiment__model=experiment.model, experiment__inference_source=experiment.inference_source,
        case_id__in=list(descriptions),
    ).exclude(experiment=experiment).select_related('experiment').order_by('id')
    for result in feature_results:
        if result.description != descriptions[result.case_id]:
            continue
        for slug, answer in result.live.items():
            if slug not in experiment.live or answer['failed']:
                continue
            if result.experiment.live[slug]['version_id'] == experiment.live[slug]['version_id']:
                known.setdefault((result.case_id, slug), answer)
    return known


def decides_to_flag(filter_definition, scores):
    return filter_score(filter_definition, scores) >= filter_definition['cutoff']


def live_flags(answer, threshold):
    return not answer['failed'] and answer['score'] >= threshold


def worth_explaining(experiment, case, scores, live):
    """Explained when asked for every post, or when some filter decides it
    wrongly or differently from its live version."""
    if experiment.explain_every_case:
        return True
    for filter_definition in experiment.filters:
        slug = filter_definition['plugin']
        if slug not in case.expected:
            continue
        flags = decides_to_flag(filter_definition, scores)
        if flags != case.expected[slug] or flags != live_flags(live[slug], experiment.live[slug]['threshold']):
            return True
    return False


def judge_feature_case(experiment, live_plugin_versions, case, known_live):
    """The fields of a FeatureResult for one case. Runs in a worker thread, so
    it never touches the database: everything it needs is passed in."""
    usage = Usage()
    messages = chat_messages(features_prompt(experiment.features), case.description, case.image_data_urls)
    outcome = ask_feature_scores(messages, experiment.features, experiment.inference_source, experiment.model)
    usage.add(outcome)
    scores = outcome.answer or {}

    live = {}
    for slug in case.expected:
        if (case.case_id, slug) in known_live:
            live[slug] = known_live[(case.case_id, slug)]
            continue
        live_version = live_plugin_versions[slug]
        live_messages = build_messages(live_version, case.description, case.image_data_urls)
        live_outcome = ask_model(live_messages, live_version, experiment.inference_source, experiment.model)
        usage.add(live_outcome)
        live[slug] = answer_record(live_outcome)

    reasons = {}
    if outcome.answer is not None and worth_explaining(experiment, case, scores, live):
        names = [feature['name'] for feature in experiment.features]
        explanation_outcome = request_explanations(
            messages, scores, names, FEATURE_EXPLANATION_REQUEST, experiment.inference_source, experiment.model)
        usage.add(explanation_outcome)
        if explanation_outcome.answer is not None:
            reasons = explanation_outcome.answer

    return {
        'case_id': case.case_id,
        'source': case.source,
        'judgment': case.judgment,
        'description': case.description,
        'post': case.post,
        'image_urls': case.image_urls,
        'post_url': case.post_url,
        'expected': case.expected,
        'owner': case.owner,
        'video_not_watched': case.video_not_watched,
        'scores': scores,
        'failed': outcome.answer is None,
        'reasons': reasons,
        'live': live,
        'prompt_tokens': usage.prompt_tokens,
        'cached_prompt_tokens': usage.cached_prompt_tokens,
        'completion_tokens': usage.completion_tokens,
        'cost': usage.cost,
    }


def run_feature_experiment(experiment):
    """Rates every case not rated yet, saving each as it finishes, then marks the experiment done."""
    cases = experiment_cases(experiment)
    experiment.total_cases = len(cases)
    experiment.save(update_fields=['total_cases'])

    rated_case_ids = set(experiment.results.values_list('case_id', flat=True))
    cases = [case for case in cases if case.case_id not in rated_case_ids]
    known_live = known_live_answers(experiment, cases)
    live_plugin_versions = {
        slug: PluginVersion.objects.select_related('plugin').get(id=live['version_id'])
        for slug, live in experiment.live.items()
    }
    with ThreadPoolExecutor(max_workers=MODEL_CALLS_AT_ONCE) as executor:
        futures = [executor.submit(judge_feature_case, experiment, live_plugin_versions, case, known_live)
                   for case in cases]
        for future in as_completed(futures):
            FeatureResult.objects.create(experiment=experiment, **future.result())
            experiment.heartbeat_at = timezone.now()
            experiment.save(update_fields=['heartbeat_at'])

    experiment.status = EXPERIMENT_DONE
    experiment.finished_at = timezone.now()
    experiment.save(update_fields=['status', 'finished_at'])


def run_next_feature_experiment():
    """Runs one waiting feature experiment. Returns False when there was none."""
    experiment = claim_next(FeatureExperiment.objects.all())
    if experiment is None:
        return False
    run_or_mark_failed(experiment, run_feature_experiment)
    return True


def run_now(experiment):
    """Runs an experiment in this process, as the command does, instead of
    waiting for the worker. It is marked running first, so the worker leaves it."""
    experiment.status = EXPERIMENT_RUNNING
    experiment.heartbeat_at = timezone.now()
    experiment.save(update_fields=['status', 'heartbeat_at'])
    run_or_mark_failed(experiment, run_feature_experiment)


# -- Counting --

def filter_counts(filter_definition, live, results, cutoff=None):
    """{cases, draft, live} for one filter over results in its test set:
    draft and live each {right, missed, wrongly_flagged, failed}. cutoff
    replaces the filter's own, to see the draft at another cutoff."""
    if cutoff is None:
        cutoff = filter_definition['cutoff']
    slug = filter_definition['plugin']
    draft_counts = dict.fromkeys(COUNT_NAMES, 0)
    live_counts = dict.fromkeys(COUNT_NAMES, 0)
    cases = 0
    for result in results:
        if slug not in result.expected:
            continue
        cases += 1
        should_flag = result.expected[slug]
        if result.failed:
            draft_counts['failed'] += 1
        else:
            count_decision(draft_counts, filter_score(filter_definition, result.scores) >= cutoff, should_flag)
        live_answer = result.live[slug]
        if live_answer['failed']:
            live_counts['failed'] += 1
        else:
            count_decision(live_counts, live_answer['score'] >= live['threshold'], should_flag)
    return {'cases': cases, 'draft': draft_counts, 'live': live_counts}


def count_decision(counts, flagged, should_flag):
    if flagged == should_flag:
        counts['right'] += 1
    elif should_flag:
        counts['missed'] += 1
    else:
        counts['wrongly_flagged'] += 1
