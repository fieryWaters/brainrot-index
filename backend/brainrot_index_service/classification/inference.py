"""Applying a plugin's rubric to a post with an OpenAI-compatible chat
completions API, either OpenRouter or a local server (INFERENCE_SOURCE).

The production worker and the evaluation command share everything here up to
the model's parsed answer; only where the post comes from and where the
answer is saved differ."""

import json
import logging
import time
from dataclasses import dataclass

import requests
from django.conf import settings
from django.utils import timezone

from .images import model_image_data_url
from .models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_FAILED,
    IMAGE_REJECTED,
    PLATFORM_YOUTUBE,
    POST_KIND_REPLY,
    TRANSCRIPT_FETCHED,
    Post,
)

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
INFERENCE_SOURCE_OPENROUTER = 'openrouter'
INFERENCE_SOURCE_LOCAL = 'local'

MAX_IMAGES_PER_POST = 4
MAX_TEXT_CHARACTERS = 6000
MAX_PARENT_TEXT_CHARACTERS = 1000
# The opening of a video's transcript is enough to judge it and keeps each call cheap.
MAX_TRANSCRIPT_WORDS = 2000
REQUEST_TIMEOUT_SECONDS = 60
MAX_RESPONSE_TOKENS = 500
# An invalid answer is retried once before the classification is marked failed.
ATTEMPTS_PER_CLASSIFICATION = 2

PLATFORM_NAMES = {'reddit': 'Reddit', 'x': 'X', 'youtube': 'YouTube'}

RESPONSE_INSTRUCTIONS = """\
Classify the single post the user sends against the rubric above. Judge only
what the post itself shows. Answer with a JSON object with exactly these
fields, in this order:
- reasoning: two or three sentences explaining your judgment, written before
  you decide the score.
- score: an integer from 0 to 100, following the score bands.
- label: exactly one of: {labels}."""


@dataclass
class ModelOutcome:
    """What the model answered for one classification. answer is None when
    every attempt failed; the measurements are those of the last attempt,
    except cost, which adds up every attempt the provider reported a cost for."""

    answer: dict | None = None
    raw_response: str = ''
    latency_ms: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    cost: float | None = None


def configured_model():
    """The model production uses with the configured INFERENCE_SOURCE."""
    if settings.INFERENCE_SOURCE == INFERENCE_SOURCE_OPENROUTER:
        return settings.OPENROUTER_MODEL
    return settings.LOCAL_INFERENCE_MODEL


def inference_endpoint(inference_source):
    """(base URL, API key) of an inference source."""
    if inference_source == INFERENCE_SOURCE_OPENROUTER:
        return OPENROUTER_BASE_URL, settings.OPENROUTER_API_KEY
    return settings.LOCAL_INFERENCE_BASE_URL, ''


def system_prompt(plugin_version):
    # The rubric comes first and never changes within a version, so providers can cache it.
    labels = ', '.join(plugin_version.allowed_labels)
    return plugin_version.rubric_prompt + '\n\n' + RESPONSE_INSTRUCTIONS.format(labels=labels)


def describe_post(platform, community, kind, text, parent_text, image_count, transcript=None):
    """The post as the model reads it. parent_text is None when a reply's
    parent post is unknown. transcript is None for a post that is not a video."""
    lines = [f"Platform: {PLATFORM_NAMES[platform]}"]
    if community:
        lines.append(f"Community: {community}")

    if kind == POST_KIND_REPLY:
        lines.append("Kind: reply")
        if parent_text is not None:
            lines.append(f"Replying to this post: {parent_text[:MAX_PARENT_TEXT_CHARACTERS]}")
    else:
        lines.append("Kind: post")

    lines.append(f"Images attached: {image_count}")
    lines.append("Text:")
    lines.append(text[:MAX_TEXT_CHARACTERS] or "(no text)")
    if transcript is not None:
        lines.append("Transcript:")
        lines.append(transcript)
    return '\n'.join(lines)


def transcript_for_model(post):
    """The opening words of a video's transcript, "(not available)" when it has
    none, or None for a post that is not a video."""
    if post.platform != PLATFORM_YOUTUBE:
        return None
    video_transcript = post.transcript
    if video_transcript.status != TRANSCRIPT_FETCHED:
        return "(not available)"
    words = video_transcript.text().split()
    if len(words) > MAX_TRANSCRIPT_WORDS:
        return ' '.join(words[:MAX_TRANSCRIPT_WORDS]) + " ..."
    return ' '.join(words)


def build_messages(plugin_version, post_description, image_urls):
    user_content = [{'type': 'text', 'text': post_description}]
    for image_url in image_urls:
        user_content.append({'type': 'image_url', 'image_url': {'url': image_url}})
    return [
        {'role': 'system', 'content': system_prompt(plugin_version)},
        {'role': 'user', 'content': user_content},
    ]


def answer_schema(allowed_labels):
    return {
        'type': 'object',
        'properties': {
            'reasoning': {'type': 'string'},
            'score': {'type': 'integer', 'minimum': 0, 'maximum': 100},
            'label': {'type': 'string', 'enum': allowed_labels},
        },
        'required': ['reasoning', 'score', 'label'],
        'additionalProperties': False,
    }


def request_chat_completion(messages, allowed_labels, inference_source, model):
    base_url, api_key = inference_endpoint(inference_source)
    request_body = {
        'model': model,
        'messages': messages,
        'temperature': 0,
        'max_tokens': MAX_RESPONSE_TOKENS,
        'response_format': {
            'type': 'json_schema',
            'json_schema': {'name': 'classification', 'strict': True, 'schema': answer_schema(allowed_labels)},
        },
    }
    if inference_source == INFERENCE_SOURCE_OPENROUTER:
        # Never fall back to a provider that would ignore the JSON schema.
        request_body['provider'] = {'require_parameters': True}

    headers = {}
    if api_key:
        headers['Authorization'] = f"Bearer {api_key}"

    return requests.post(
        f"{base_url}/chat/completions",
        json=request_body,
        headers=headers,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


def parse_answer(answer_text, allowed_labels):
    """The model's answer as a dict, or None when it does not match the schema."""
    try:
        answer = json.loads(answer_text)
    except json.JSONDecodeError:
        return None

    if not isinstance(answer, dict) or set(answer) != {'reasoning', 'score', 'label'}:
        return None
    if not isinstance(answer['reasoning'], str) or not answer['reasoning'].strip():
        return None
    # bool is a subclass of int, so compare the type exactly.
    if type(answer['score']) is not int or not 0 <= answer['score'] <= 100:
        return None
    if answer['label'] not in allowed_labels:
        return None
    return answer


def ask_model(messages, allowed_labels, inference_source, model):
    """Sends the messages to the model, retrying once after a failed request
    or an invalid answer, and returns a ModelOutcome."""
    outcome = ModelOutcome()
    for attempt in range(1, ATTEMPTS_PER_CLASSIFICATION + 1):
        started_at = time.monotonic()
        try:
            response = request_chat_completion(messages, allowed_labels, inference_source, model)
            outcome.latency_ms = round((time.monotonic() - started_at) * 1000)
            outcome.raw_response = response.text
            response.raise_for_status()
            completion = response.json()
            usage = completion.get('usage') or {}
            outcome.prompt_tokens = usage.get('prompt_tokens')
            outcome.completion_tokens = usage.get('completion_tokens')
            if usage.get('cost') is not None:
                outcome.cost = (outcome.cost or 0) + usage['cost']
            outcome.answer = parse_answer(completion['choices'][0]['message']['content'], allowed_labels)
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
            logger.warning("Model request attempt %s failed: %s", attempt, error)
            continue
        if outcome.answer is not None:
            break
        logger.warning("Model request attempt %s gave an invalid answer", attempt)
    return outcome


def stored_parent_text(post):
    """The text of a reply's parent post, or None when it was never seen."""
    parent_post = Post.objects.filter(platform=post.platform, post_id=post.parent_post_id).first()
    if parent_post is None:
        return None
    return parent_post.text


def run_classification(classification):
    """Calls the model for one pending classification and saves the outcome."""
    plugin_version = classification.plugin_version
    post = classification.post

    images_with_data = []
    for post_image in post.images.exclude(status=IMAGE_REJECTED).order_by('id')[:MAX_IMAGES_PER_POST]:
        data_url = model_image_data_url(post_image)
        if data_url is not None:
            images_with_data.append((post_image, data_url))

    parent_text = None
    if post.kind == POST_KIND_REPLY:
        parent_text = stored_parent_text(post)
    post_description = describe_post(
        post.platform, post.community, post.kind, post.text, parent_text, len(images_with_data),
        transcript_for_model(post))

    messages_to_send = build_messages(
        plugin_version, post_description, [data_url for _, data_url in images_with_data])
    # The stored prompt points at the stored images instead of repeating their bytes.
    messages_to_store = build_messages(
        plugin_version, post_description, [f"post_image:{post_image.id}" for post_image, _ in images_with_data])

    model = configured_model()
    classification.prompt = messages_to_store
    classification.model = model
    classification.inference_source = settings.INFERENCE_SOURCE

    outcome = ask_model(messages_to_send, plugin_version.allowed_labels, settings.INFERENCE_SOURCE, model)
    classification.raw_response = outcome.raw_response
    classification.latency_ms = outcome.latency_ms
    classification.prompt_tokens = outcome.prompt_tokens
    classification.completion_tokens = outcome.completion_tokens

    if outcome.answer is None:
        logger.warning("Classification %s failed", classification.id)
        classification.status = CLASSIFICATION_FAILED
    else:
        classification.status = CLASSIFICATION_DONE
        classification.score = outcome.answer['score']
        classification.label = outcome.answer['label']
        classification.reasoning = outcome.answer['reasoning']
    classification.completed_at = timezone.now()
    classification.save()
