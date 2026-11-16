"""Applying a plugin's rubric to a post with an OpenAI-compatible chat
completions API, either OpenRouter or a local server (INFERENCE_SOURCE)."""

import json
import logging
import time

import requests
from django.conf import settings
from django.utils import timezone

from .images import model_image_data_url
from .models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_FAILED,
    IMAGE_DOWNLOADED,
    POST_KIND_REPLY,
    Post,
)

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
INFERENCE_SOURCE_OPENROUTER = 'openrouter'
INFERENCE_SOURCE_LOCAL = 'local'

MAX_IMAGES_PER_POST = 4
MAX_TEXT_CHARACTERS = 6000
MAX_PARENT_TEXT_CHARACTERS = 1000
REQUEST_TIMEOUT_SECONDS = 60
MAX_RESPONSE_TOKENS = 500
# An invalid answer is retried once before the classification is marked failed.
ATTEMPTS_PER_CLASSIFICATION = 2

PLATFORM_NAMES = {'reddit': 'Reddit', 'x': 'X'}

RESPONSE_INSTRUCTIONS = """\
Classify the single post the user sends against the rubric above. Judge only
what the post itself shows. Answer with a JSON object with exactly these
fields, in this order:
- reasoning: two or three sentences explaining your judgment, written before
  you decide the score.
- score: an integer from 0 to 100, following the score bands.
- label: exactly one of: {labels}."""


def inference_endpoint():
    """(base URL, API key, model) for the configured INFERENCE_SOURCE."""
    if settings.INFERENCE_SOURCE == INFERENCE_SOURCE_OPENROUTER:
        return OPENROUTER_BASE_URL, settings.OPENROUTER_API_KEY, settings.OPENROUTER_MODEL
    return settings.LOCAL_INFERENCE_BASE_URL, '', settings.LOCAL_INFERENCE_MODEL


def system_prompt(plugin_version):
    # The rubric comes first and never changes within a version, so providers can cache it.
    labels = ', '.join(plugin_version.allowed_labels)
    return plugin_version.rubric_prompt + '\n\n' + RESPONSE_INSTRUCTIONS.format(labels=labels)


def describe_post(post, image_count):
    lines = [f"Platform: {PLATFORM_NAMES[post.platform]}"]
    if post.community:
        lines.append(f"Community: {post.community}")

    if post.kind == POST_KIND_REPLY:
        lines.append("Kind: reply")
        parent_post = Post.objects.filter(platform=post.platform, post_id=post.parent_post_id).first()
        if parent_post is not None:
            lines.append(f"Replying to this post: {parent_post.text[:MAX_PARENT_TEXT_CHARACTERS]}")
    else:
        lines.append("Kind: post")

    lines.append(f"Images attached: {image_count}")
    lines.append("Text:")
    lines.append(post.text[:MAX_TEXT_CHARACTERS] or "(no text)")
    return '\n'.join(lines)


def build_messages(plugin_version, post, image_urls):
    user_content = [{'type': 'text', 'text': describe_post(post, len(image_urls))}]
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


def request_chat_completion(messages, allowed_labels):
    base_url, api_key, model = inference_endpoint()
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
    if settings.INFERENCE_SOURCE == INFERENCE_SOURCE_OPENROUTER:
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


def run_classification(classification):
    """Calls the model for one pending classification and saves the outcome."""
    plugin_version = classification.plugin_version
    post = classification.post

    images_with_data = []
    for post_image in post.images.filter(status=IMAGE_DOWNLOADED).order_by('id')[:MAX_IMAGES_PER_POST]:
        data_url = model_image_data_url(post_image)
        if data_url is not None:
            images_with_data.append((post_image, data_url))

    messages_to_send = build_messages(plugin_version, post, [data_url for _, data_url in images_with_data])
    # The stored prompt points at the stored images instead of repeating their bytes.
    messages_to_store = build_messages(
        plugin_version, post, [f"post_image:{post_image.id}" for post_image, _ in images_with_data])

    _, _, model = inference_endpoint()
    classification.prompt = messages_to_store
    classification.model = model
    classification.inference_source = settings.INFERENCE_SOURCE

    answer = None
    for attempt in range(1, ATTEMPTS_PER_CLASSIFICATION + 1):
        started_at = time.monotonic()
        try:
            response = request_chat_completion(messages_to_send, plugin_version.allowed_labels)
            classification.latency_ms = round((time.monotonic() - started_at) * 1000)
            classification.raw_response = response.text
            response.raise_for_status()
            completion = response.json()
            usage = completion.get('usage') or {}
            classification.prompt_tokens = usage.get('prompt_tokens')
            classification.completion_tokens = usage.get('completion_tokens')
            answer = parse_answer(completion['choices'][0]['message']['content'], plugin_version.allowed_labels)
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
            logger.warning("Classification %s attempt %s failed: %s", classification.id, attempt, error)
            continue
        if answer is not None:
            break
        logger.warning("Classification %s attempt %s gave an invalid answer", classification.id, attempt)

    if answer is None:
        classification.status = CLASSIFICATION_FAILED
    else:
        classification.status = CLASSIFICATION_DONE
        classification.score = answer['score']
        classification.label = answer['label']
        classification.reasoning = answer['reasoning']
    classification.completed_at = timezone.now()
    classification.save()
