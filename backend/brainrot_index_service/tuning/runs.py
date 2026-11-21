"""Running an experiment: judging each case with the draft and with the live
version, through the production prompt, model and answer parsing.

The cases are the owner's thumbs that say what the filter should have
decided. The background worker runs one experiment at a time per claim, with
a few model calls in flight, and saves each case as it finishes so the page
can show progress.

The decisions come from the production prompt unchanged. Asking for
explanations in the same prompt changes the answers, so an answer is
explained afterwards, in a follow-up turn of the same conversation."""

import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import timedelta

import requests
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from classification.evaluation import expected_answer, owner_judgments
from classification.inference import (
    INFERENCE_SOURCE_OPENROUTER,
    REQUEST_TIMEOUT_SECONDS,
    ModelOutcome,
    ask_model,
    build_messages,
    describe_stored_post,
    images_for_model,
    inference_endpoint,
    stored_reply_context,
)
from classification.models import PLUGIN_INPUT_VIDEO, POST_KIND_REPLY, VIDEO_READY, PostJudgment, PostVideo

from .models import (
    EXPERIMENT_DONE,
    EXPERIMENT_FAILED,
    EXPERIMENT_PENDING,
    EXPERIMENT_RUNNING,
    TuningExperiment,
    TuningResult,
)

logger = logging.getLogger(__name__)

MODEL_CALLS_AT_ONCE = 8
# A running experiment without progress for this long lost its worker and is taken up again.
STALLED_AFTER = timedelta(minutes=5)
MAX_EXPLANATION_TOKENS = 2000

EXPLANATION_REQUEST = """\
For each criterion, explain in one or two sentences why you judged it met or
not met in your answer above. Answer with a JSON object with one field per
criterion, named as above, holding its explanation."""


@dataclass
class Case:
    """One post to judge, with what the owner says the filter should decide."""

    case_id: str
    should_flag: bool
    owner: dict
    description: str
    post: dict
    image_data_urls: list
    image_urls: list = field(default_factory=list)
    post_url: str = ''
    judgment: PostJudgment | None = None
    video_not_watched: bool = False


def owner_judgments_for(plugin):
    """(judgment, expected answer) for each of the owner's thumbs in this
    filter's test set: those labeled should be shown, and those labeled
    should be blocked as this filter."""
    found = []
    for judgment in owner_judgments():
        expected = expected_answer(judgment, plugin.slug)
        if expected is not None:
            found.append((judgment, expected))
    return found


def post_as_read(post):
    """A stored post as a reader sees it in the feed, with the posts a reply
    answers: {platform, kind, author, community, text, quoted_post,
    link_preview, parent_text, parent_is_reply, thread_text}, the last three
    as stored_reply_context gives them."""
    shown = {
        'platform': post.platform,
        'kind': post.kind,
        'author': post.author,
        'community': post.community,
        'text': post.text,
        'quoted_post': post.quoted_post,
        'link_preview': post.link_preview,
        'parent_text': None,
        'parent_is_reply': False,
        'thread_text': None,
    }
    if post.kind == POST_KIND_REPLY:
        shown['parent_text'], shown['parent_is_reply'], shown['thread_text'], _ = stored_reply_context(post)
    return shown


def thumb_fields(judgment):
    """What a case of a thumbs holds, its post described exactly as the
    production worker describes it, as Case fields."""
    post = judgment.post
    images_with_data = images_for_model(post)
    if judgment.plugin is not None:
        plugin_named = judgment.plugin.slug
    else:
        plugin_named = ''
    return {
        'case_id': f"judgment-{judgment.id}",
        'owner': {
            'verdict': judgment.verdict,
            'shown_action': judgment.shown_action,
            'should_be': judgment.should_be,
            'plugin': plugin_named,
            'details': judgment.details,
        },
        'description': describe_stored_post(post, len(images_with_data)),
        'post': post_as_read(post),
        'image_data_urls': [data_url for _, data_url in images_with_data],
        'image_urls': [post_image.source_url for post_image, _ in images_with_data],
        'post_url': post.url,
        'judgment': judgment,
    }


def video_was_watched(post):
    return PostVideo.objects.filter(post=post, status=VIDEO_READY).exists()


def thumb_case(judgment, expected, plugin):
    video_not_watched = plugin.input_kind == PLUGIN_INPUT_VIDEO and video_was_watched(judgment.post)
    return Case(should_flag=expected['flag'], video_not_watched=video_not_watched, **thumb_fields(judgment))


def experiment_cases(experiment):
    plugin = experiment.plugin
    return [thumb_case(judgment, expected, plugin) for judgment, expected in owner_judgments_for(plugin)]


def answer_record(outcome):
    if outcome.answer is None:
        return {'failed': True, 'score': None, 'criteria_met': [], 'reasoning': ''}
    return {
        'failed': False,
        'score': outcome.answer['score'],
        'criteria_met': outcome.answer['criteria_met'],
        'reasoning': outcome.answer['reasoning'],
    }


def decides_to_flag(answer, threshold):
    return not answer['failed'] and answer['score'] >= threshold


def explanation_schema(names):
    properties = {name: {'type': 'string'} for name in names}
    return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}


def request_explanations(messages, answer_given, names, explanation_request, inference_source, model):
    """Asks the model, after its answer (answer_given, as it was sent), why it
    answered each named field as it did. Returns a ModelOutcome whose answer
    is {name: explanation}, or None when the request failed. Tried once: an
    explanation is a help, not a result."""
    request_body = {
        'model': model,
        'messages': messages + [
            {'role': 'assistant', 'content': json.dumps(answer_given)},
            {'role': 'user', 'content': explanation_request},
        ],
        'temperature': 0,
        'max_tokens': MAX_EXPLANATION_TOKENS,
        'response_format': {
            'type': 'json_schema',
            'json_schema': {'name': 'explanations', 'strict': True, 'schema': explanation_schema(names)},
        },
    }
    if inference_source == INFERENCE_SOURCE_OPENROUTER:
        request_body['provider'] = {'require_parameters': True}
    base_url, api_key = inference_endpoint(inference_source)
    headers = {}
    if api_key:
        headers['Authorization'] = f"Bearer {api_key}"

    outcome = ModelOutcome()
    try:
        response = requests.post(f"{base_url}/chat/completions", json=request_body, headers=headers,
                                 timeout=REQUEST_TIMEOUT_SECONDS)
        response.raise_for_status()
        completion = response.json()
        usage = completion.get('usage') or {}
        outcome.prompt_tokens = usage.get('prompt_tokens')
        outcome.cached_prompt_tokens = (usage.get('prompt_tokens_details') or {}).get('cached_tokens')
        outcome.completion_tokens = usage.get('completion_tokens')
        outcome.cost = usage.get('cost')
        explanations = json.loads(completion['choices'][0]['message']['content'])
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
        logger.warning("Explanation request failed: %s", error)
        return outcome
    if isinstance(explanations, dict) and all(isinstance(explanations.get(name), str) for name in names):
        outcome.answer = {name: explanations[name] for name in names}
    return outcome


def criteria_explanations(messages, answer, plugin_version, inference_source, model):
    """Why the draft's answer judged each criterion met or not met."""
    criteria = plugin_version.criteria
    answer_given = {'reasoning': answer['reasoning']}
    for criterion in criteria:
        answer_given[criterion['name']] = criterion['name'] in answer['criteria_met']
    names = [criterion['name'] for criterion in criteria]
    return request_explanations(messages, answer_given, names, EXPLANATION_REQUEST, inference_source, model)


@dataclass
class Usage:
    """The tokens and cost of every model call made for one case."""

    prompt_tokens: int = 0
    cached_prompt_tokens: int = 0
    completion_tokens: int = 0
    cost: float | None = None

    def add(self, outcome):
        self.prompt_tokens += outcome.prompt_tokens or 0
        self.cached_prompt_tokens += outcome.cached_prompt_tokens or 0
        self.completion_tokens += outcome.completion_tokens or 0
        if outcome.cost is not None:
            self.cost = (self.cost or 0) + outcome.cost


def judge_case(experiment, draft_version, live_version, case, reused_live_answer):
    """The fields of a TuningResult for one case. Runs in a worker thread, so
    it never touches the database: everything it needs is passed in."""
    usage = Usage()
    draft_messages = build_messages(draft_version, case.description, case.image_data_urls)
    draft_outcome = ask_model(draft_messages, draft_version, experiment.inference_source, experiment.model)
    usage.add(draft_outcome)
    draft = answer_record(draft_outcome)

    if reused_live_answer is not None:
        live = reused_live_answer
    else:
        live_messages = build_messages(live_version, case.description, case.image_data_urls)
        live_outcome = ask_model(live_messages, live_version, experiment.inference_source, experiment.model)
        usage.add(live_outcome)
        live = answer_record(live_outcome)

    draft_flags = decides_to_flag(draft, experiment.threshold)
    draft_is_wrong = draft_flags != case.should_flag
    differs_from_live = draft_flags != decides_to_flag(live, experiment.live_threshold)
    explanations = {}
    if not draft['failed'] and (experiment.explain_every_case or draft_is_wrong or differs_from_live):
        explanation_outcome = criteria_explanations(
            draft_messages, draft, draft_version, experiment.inference_source, experiment.model)
        usage.add(explanation_outcome)
        if explanation_outcome.answer is not None:
            explanations = explanation_outcome.answer

    return {
        'case_id': case.case_id,
        'judgment': case.judgment,
        'description': case.description,
        'post': case.post,
        'image_urls': case.image_urls,
        'post_url': case.post_url,
        'should_flag': case.should_flag,
        'owner': case.owner,
        'video_not_watched': case.video_not_watched,
        'draft': draft,
        'live': live,
        'live_reused': reused_live_answer is not None,
        'explanations': explanations,
        'prompt_tokens': usage.prompt_tokens,
        'completion_tokens': usage.completion_tokens,
        'cost': usage.cost,
    }


def reusable_live_answers(experiment, cases):
    """The live version's answers from earlier experiments with the same live
    version, model and inference source, by case id, for the cases whose post
    reads the same. Judging the live version again would give the same answers."""
    descriptions = {case.case_id: case.description for case in cases}
    earlier_results = (
        TuningResult.objects
        .filter(experiment__live_version=experiment.live_version,
                experiment__model=experiment.model,
                experiment__inference_source=experiment.inference_source,
                case_id__in=list(descriptions))
        .exclude(experiment=experiment)
        .order_by('id')
    )
    reusable = {}
    for result in earlier_results:
        if not result.live['failed'] and result.description == descriptions[result.case_id]:
            reusable[result.case_id] = result.live
    return reusable


def claim_next(experiments):
    """Marks the oldest waiting experiment of a queryset running and returns
    it, or None. A running experiment that stalled is waiting again."""
    with transaction.atomic():
        stalled = Q(status=EXPERIMENT_RUNNING, heartbeat_at__lt=timezone.now() - STALLED_AFTER)
        experiment = (
            experiments
            .select_for_update(skip_locked=True, of=('self',))
            .filter(Q(status=EXPERIMENT_PENDING) | stalled)
            .order_by('id')
            .first()
        )
        if experiment is None:
            return None
        experiment.status = EXPERIMENT_RUNNING
        experiment.heartbeat_at = timezone.now()
        experiment.save(update_fields=['status', 'heartbeat_at'])
    return experiment


def run_or_mark_failed(experiment, run):
    try:
        run(experiment)
    except Exception as error:
        # A run that cannot finish is marked failed rather than taken up again and again.
        logger.exception("Experiment %s failed", experiment)
        experiment.status = EXPERIMENT_FAILED
        experiment.error = str(error)
        experiment.finished_at = timezone.now()
        experiment.save(update_fields=['status', 'error', 'finished_at'])


def run_experiment(experiment):
    """Judges every case not judged yet, saving each as it finishes, then marks the experiment done."""
    cases = experiment_cases(experiment)
    experiment.total_cases = len(cases)
    experiment.save(update_fields=['total_cases'])

    judged_case_ids = set(experiment.results.values_list('case_id', flat=True))
    cases = [case for case in cases if case.case_id not in judged_case_ids]
    reusable = reusable_live_answers(experiment, cases)
    draft_version = experiment.draft_version()
    live_version = experiment.live_version
    with ThreadPoolExecutor(max_workers=MODEL_CALLS_AT_ONCE) as executor:
        futures = [
            executor.submit(judge_case, experiment, draft_version, live_version, case, reusable.get(case.case_id))
            for case in cases
        ]
        for future in as_completed(futures):
            TuningResult.objects.create(experiment=experiment, **future.result())
            experiment.heartbeat_at = timezone.now()
            experiment.save(update_fields=['heartbeat_at'])

    experiment.status = EXPERIMENT_DONE
    experiment.finished_at = timezone.now()
    experiment.save(update_fields=['status', 'finished_at'])


def run_next_tuning_experiment():
    """Runs one waiting experiment. Returns False when there was none."""
    experiment = claim_next(TuningExperiment.objects.select_related('plugin', 'live_version'))
    if experiment is None:
        return False
    run_or_mark_failed(experiment, run_experiment)
    return True
