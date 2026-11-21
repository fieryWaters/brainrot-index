"""Running an experiment: judging each case with the draft and with the live
version, through the production prompt, model and answer parsing.

The cases are the owner's thumbs that say what the filter should have
decided, and, when asked for, the synthetic test set's examples for the
filter. The background worker runs one experiment at a time per claim, with
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
from pathlib import Path

import requests
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from classification.evaluation import example_description_and_images, expected_answers, load_examples
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
    CASE_SYNTHETIC,
    CASE_THUMB,
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
    source: str
    should_flag: bool
    owner: dict
    description: str
    post: dict
    image_data_urls: list
    image_urls: list = field(default_factory=list)
    post_url: str = ''
    judgment: PostJudgment | None = None
    video_not_watched: bool = False


def owner_judgments():
    return PostJudgment.objects.filter(user__email__iexact=settings.ADMIN_EMAIL).select_related('post', 'plugin').order_by('id')


def owner_judgments_for(plugin):
    """(judgment, expected answer) for each of the owner's thumbs that says
    what this filter should have decided."""
    found = []
    for judgment in owner_judgments():
        expected = expected_answers(judgment).get(plugin.slug)
        if expected is not None:
            found.append((judgment, expected))
    return found


def synthetic_examples_for(plugin):
    """The synthetic test set's examples with an answer for this filter;
    none when the test set is not where the settings say."""
    dataset_path = Path(settings.TUNING_SYNTHETIC_DATASET)
    if not dataset_path.exists():
        return []
    return [example for example in load_examples(dataset_path) if plugin.slug in example.get('expected', {})]


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


def example_as_read(example):
    """A synthetic test set example in the form post_as_read gives; the test set names no authors."""
    return {
        'platform': example['platform'],
        'kind': example['kind'],
        'author': '',
        'community': example.get('community', ''),
        'text': example['text'],
        'quoted_post': example.get('quoted_post') or {},
        'link_preview': example.get('link_preview') or {},
        'parent_text': example.get('parent_text'),
        'parent_is_reply': example.get('parent_is_reply', False),
        'thread_text': example.get('thread_text'),
    }


def thumb_case(judgment, expected, plugin):
    """A thumbs as a case, described exactly as the production worker describes its post."""
    post = judgment.post
    images_with_data = images_for_model(post)
    video_not_watched = (plugin.input_kind == PLUGIN_INPUT_VIDEO
                         and PostVideo.objects.filter(post=post, status=VIDEO_READY).exists())
    if judgment.plugin is not None:
        plugin_named = judgment.plugin.slug
    else:
        plugin_named = ''
    return Case(
        case_id=f"judgment-{judgment.id}",
        source=CASE_THUMB,
        should_flag=expected['flag'],
        owner={
            'verdict': judgment.verdict,
            'shown_action': judgment.shown_action,
            'plugin': plugin_named,
            'details': judgment.details,
        },
        description=describe_stored_post(post, len(images_with_data)),
        post=post_as_read(post),
        image_data_urls=[data_url for _, data_url in images_with_data],
        image_urls=[post_image.source_url for post_image, _ in images_with_data],
        post_url=post.url,
        judgment=judgment,
        video_not_watched=video_not_watched,
    )


def synthetic_case(example, plugin):
    images_dir = Path(settings.TUNING_SYNTHETIC_DATASET).parent / 'images'
    description, image_data_urls = example_description_and_images(example, images_dir)
    expected = example['expected'][plugin.slug]
    return Case(
        case_id=example['id'],
        source=CASE_SYNTHETIC,
        should_flag=expected['flag'],
        owner={'why': expected['why']},
        description=description,
        post=example_as_read(example),
        image_data_urls=image_data_urls,
    )


def experiment_cases(experiment):
    plugin = experiment.plugin
    cases = [thumb_case(judgment, expected, plugin) for judgment, expected in owner_judgments_for(plugin)]
    if experiment.include_synthetic:
        cases += [synthetic_case(example, plugin) for example in synthetic_examples_for(plugin)]
    return cases


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


def explanation_schema(criteria):
    properties = {criterion['name']: {'type': 'string'} for criterion in criteria}
    return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}


def request_explanations(messages, answer, plugin_version, inference_source, model):
    """Asks the model, after its answer, why it judged each criterion as it
    did. Returns a ModelOutcome whose answer is {criterion name: explanation},
    or None when the request failed. Tried once: an explanation is a help, not a result."""
    criteria = plugin_version.criteria
    answer_given = {'reasoning': answer['reasoning']}
    for criterion in criteria:
        answer_given[criterion['name']] = criterion['name'] in answer['criteria_met']
    request_body = {
        'model': model,
        'messages': messages + [
            {'role': 'assistant', 'content': json.dumps(answer_given)},
            {'role': 'user', 'content': EXPLANATION_REQUEST},
        ],
        'temperature': 0,
        'max_tokens': MAX_EXPLANATION_TOKENS,
        'response_format': {
            'type': 'json_schema',
            'json_schema': {'name': 'explanations', 'strict': True, 'schema': explanation_schema(criteria)},
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
        outcome.completion_tokens = usage.get('completion_tokens')
        outcome.cost = usage.get('cost')
        explanations = json.loads(completion['choices'][0]['message']['content'])
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
        logger.warning("Explanation request failed: %s", error)
        return outcome
    if isinstance(explanations, dict) and all(isinstance(explanations.get(c['name']), str) for c in criteria):
        outcome.answer = {criterion['name']: explanations[criterion['name']] for criterion in criteria}
    return outcome


@dataclass
class Usage:
    """The tokens and cost of every model call made for one case."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost: float | None = None

    def add(self, outcome):
        self.prompt_tokens += outcome.prompt_tokens or 0
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
        explanation_outcome = request_explanations(
            draft_messages, draft, draft_version, experiment.inference_source, experiment.model)
        usage.add(explanation_outcome)
        if explanation_outcome.answer is not None:
            explanations = explanation_outcome.answer

    return {
        'case_id': case.case_id,
        'source': case.source,
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


def claim_next_experiment():
    """Marks the oldest waiting experiment running and returns it, or None.
    A running experiment that stalled is waiting again."""
    with transaction.atomic():
        stalled = Q(status=EXPERIMENT_RUNNING, heartbeat_at__lt=timezone.now() - STALLED_AFTER)
        experiment = (
            TuningExperiment.objects
            .select_for_update(skip_locked=True, of=('self',))
            .filter(Q(status=EXPERIMENT_PENDING) | stalled)
            .select_related('plugin', 'live_version')
            .order_by('id')
            .first()
        )
        if experiment is None:
            return None
        experiment.status = EXPERIMENT_RUNNING
        experiment.heartbeat_at = timezone.now()
        experiment.save(update_fields=['status', 'heartbeat_at'])
    return experiment


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
    experiment = claim_next_experiment()
    if experiment is None:
        return False
    try:
        run_experiment(experiment)
    except Exception as error:
        # A run that cannot finish, such as one whose synthetic test set is unreadable, is marked failed
        # rather than taken up again and again.
        logger.exception("Tuning experiment %s failed", experiment.id)
        experiment.status = EXPERIMENT_FAILED
        experiment.error = str(error)
        experiment.finished_at = timezone.now()
        experiment.save(update_fields=['status', 'error', 'finished_at'])
    return True
