"""Applying a plugin's rubric to a post with an OpenAI-compatible chat
completions API, either OpenRouter or a local server (INFERENCE_SOURCE).

The production worker and the evaluation command share everything here up to
the model's parsed answer; only where the post comes from and where the
answer is saved differ."""

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
    VideoTranscript,
)
from .scoring import answer_schema, parse_answer, response_instructions

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
INFERENCE_SOURCE_OPENROUTER = 'openrouter'
INFERENCE_SOURCE_LOCAL = 'local'

# Every image the reader sees, up to a full Reddit gallery (20 pages).
MAX_IMAGES_PER_POST = 20
MAX_TEXT_CHARACTERS = 6000
MAX_PARENT_TEXT_CHARACTERS = 1000
# How many replies up a thread is followed to find its post.
MAX_THREAD_DEPTH = 50
# The opening of a video's transcript is enough to judge it and keeps each call cheap.
MAX_TRANSCRIPT_WORDS = 2000
REQUEST_TIMEOUT_SECONDS = 60
MAX_RESPONSE_TOKENS = 500
# Room for an explanation of every criterion, which only evaluation asks for.
MAX_EXPLAINED_RESPONSE_TOKENS = 2000
# An invalid answer is retried once before the classification is marked failed.
ATTEMPTS_PER_CLASSIFICATION = 2

PLATFORM_NAMES = {'reddit': 'Reddit', 'x': 'X', 'youtube': 'YouTube'}


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


def system_prompt(plugin_version, explain=False):
    # The rubric comes first and never changes within a version, so providers can cache it.
    return plugin_version.rubric_prompt + '\n\n' + response_instructions(plugin_version, explain)


def describe_shown_content(text, quoted_post, link_preview):
    """What the post shows in words: its own text, then the post it quotes and
    the preview of the page it links to, each empty when there is none."""
    lines = ["Text:", text[:MAX_TEXT_CHARACTERS] or "(no text)"]
    if quoted_post:
        lines.append(f"Quoted post, by {quoted_post['author'] or 'an unknown author'}:")
        lines.append(quoted_post['text'][:MAX_TEXT_CHARACTERS] or "(no text)")
    if link_preview:
        if link_preview['domain']:
            lines.append(f"Link preview, from {link_preview['domain']}:")
        else:
            lines.append("Link preview:")
        # A preview showing no text, as a Reddit link post's, is described by its address.
        lines.append(link_preview['text'][:MAX_TEXT_CHARACTERS] or link_preview['url'])
    return lines


def describe_post(platform, community, kind, text, parent_text, image_count, transcript=None,
                  quoted_post=None, link_preview=None, has_video=False, parent_is_reply=False, thread_text=None,
                  video_shown=None):
    """The post as the model reads it. parent_text is the text of what a reply
    answers, None when that was never seen; parent_is_reply says it is another
    reply, whose thread starts with the post of thread_text (None when unseen).
    transcript is None for a post that is not a video.
    has_video says the post shows a video or GIF. video_shown says how much of
    it is attached for the model to watch, or is None when it is not attached
    and the images include only its thumbnail."""
    lines = [f"Platform: {PLATFORM_NAMES[platform]}"]
    if community:
        lines.append(f"Community: {community}")

    if kind == POST_KIND_REPLY:
        lines.append("Kind: reply")
        if thread_text is not None:
            lines.append(f"In the thread of this post: {thread_text[:MAX_PARENT_TEXT_CHARACTERS]}")
        if parent_text is not None and parent_is_reply:
            lines.append(f"Replying to this reply: {parent_text[:MAX_PARENT_TEXT_CHARACTERS]}")
        elif parent_text is not None:
            lines.append(f"Replying to this post: {parent_text[:MAX_PARENT_TEXT_CHARACTERS]}")
    else:
        lines.append("Kind: post")

    lines.append(f"Images attached: {image_count}")
    if video_shown is not None:
        lines.append(f"Video attached: {video_shown}")
    elif has_video:
        lines.append("Video: yes (its thumbnail is among the images)")
    lines.extend(describe_shown_content(text, quoted_post, link_preview))
    if transcript is not None:
        lines.append("Transcript:")
        lines.append(transcript)
    return '\n'.join(lines)


def transcript_for_model(post):
    """The opening words of a video's transcript, "(not available)" when it has
    none, or None for a post that is not a video."""
    if post.platform != PLATFORM_YOUTUBE:
        return None
    video_transcript = VideoTranscript.objects.filter(post=post).first()
    if video_transcript is None or video_transcript.status != TRANSCRIPT_FETCHED:
        return "(not available)"
    words = video_transcript.text().split()
    if len(words) > MAX_TRANSCRIPT_WORDS:
        return ' '.join(words[:MAX_TRANSCRIPT_WORDS]) + " ..."
    return ' '.join(words)


def build_messages(plugin_version, post_description, image_urls, explain=False):
    user_content = [{'type': 'text', 'text': post_description}]
    for image_url in image_urls:
        user_content.append({'type': 'image_url', 'image_url': {'url': image_url}})
    return [
        {'role': 'system', 'content': system_prompt(plugin_version, explain)},
        {'role': 'user', 'content': user_content},
    ]


def request_chat_completion(messages, plugin_version, inference_source, model, explain=False):
    base_url, api_key = inference_endpoint(inference_source)
    if explain:
        max_tokens = MAX_EXPLAINED_RESPONSE_TOKENS
    else:
        max_tokens = MAX_RESPONSE_TOKENS
    request_body = {
        'model': model,
        'messages': messages,
        'temperature': 0,
        'max_tokens': max_tokens,
        'response_format': {
            'type': 'json_schema',
            'json_schema': {'name': 'classification', 'strict': True, 'schema': answer_schema(plugin_version, explain)},
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


def ask_model(messages, plugin_version, inference_source, model, explain=False):
    """Sends the messages to the model, retrying once after a failed request
    or an invalid answer, and returns a ModelOutcome. explain, for evaluation
    only, also asks the model to explain its answer on each criterion."""
    outcome = ModelOutcome()
    for attempt in range(1, ATTEMPTS_PER_CLASSIFICATION + 1):
        started_at = time.monotonic()
        try:
            response = request_chat_completion(messages, plugin_version, inference_source, model, explain)
            outcome.latency_ms = round((time.monotonic() - started_at) * 1000)
            outcome.raw_response = response.text
            response.raise_for_status()
            completion = response.json()
            usage = completion.get('usage') or {}
            outcome.prompt_tokens = usage.get('prompt_tokens')
            outcome.completion_tokens = usage.get('completion_tokens')
            if usage.get('cost') is not None:
                outcome.cost = (outcome.cost or 0) + usage['cost']
            outcome.answer = parse_answer(completion['choices'][0]['message']['content'], plugin_version, explain)
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
            logger.warning("Model request attempt %s failed: %s", attempt, error)
            continue
        if outcome.answer is not None:
            break
        logger.warning("Model request attempt %s gave an invalid answer", attempt)
    return outcome


def stored_parent_text(post):
    """The text of what a reply answers, a post or another reply, or None when it was never seen."""
    parent_post = Post.objects.filter(platform=post.platform, post_id=post.parent_post_id).first()
    if parent_post is None:
        return None
    return parent_post.text


def stored_reply_context(post):
    """(parent_text, parent_is_reply, thread_text) of a reply, as describe_post
    takes them. A reply's parent is what it answers, a post or another reply;
    the parents of replies lead up to the thread's post."""
    parent_post = Post.objects.filter(platform=post.platform, post_id=post.parent_post_id).first()
    if parent_post is None:
        return None, False, None
    if parent_post.kind != POST_KIND_REPLY:
        return parent_post.text, False, None
    ancestor = parent_post
    for _ in range(MAX_THREAD_DEPTH):
        ancestor = Post.objects.filter(platform=post.platform, post_id=ancestor.parent_post_id).first()
        if ancestor is None:
            return parent_post.text, True, None
        if ancestor.kind != POST_KIND_REPLY:
            return parent_post.text, True, ancestor.text
    return parent_post.text, True, None


def images_for_model(post):
    """(PostImage, data URL) of each image of the post the model is shown."""
    images_with_data = []
    for post_image in post.images.exclude(status=IMAGE_REJECTED).order_by('id')[:MAX_IMAGES_PER_POST]:
        data_url = model_image_data_url(post_image)
        if data_url is not None:
            images_with_data.append((post_image, data_url))
    return images_with_data


def describe_stored_post(post, image_count, video_shown=None):
    parent_text, parent_is_reply, thread_text = None, False, None
    if post.kind == POST_KIND_REPLY:
        parent_text, parent_is_reply, thread_text = stored_reply_context(post)
    return describe_post(
        post.platform, post.community, post.kind, post.text, parent_text, image_count,
        transcript_for_model(post), post.quoted_post, post.link_preview, post.video_url != '',
        parent_is_reply, thread_text, video_shown)


def save_outcome(classification, outcome):
    """Saves the model's answer, or the failure, on a classification the
    model was asked about."""
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
        classification.criteria_met = outcome.answer['criteria_met']
    classification.completed_at = timezone.now()
    classification.save()


def run_classification(classification):
    """Calls the model for one pending classification and saves the outcome."""
    plugin_version = classification.plugin_version
    post = classification.post

    images_with_data = images_for_model(post)
    post_description = describe_stored_post(post, len(images_with_data))

    messages_to_send = build_messages(
        plugin_version, post_description, [data_url for _, data_url in images_with_data])
    # The stored prompt points at the stored images instead of repeating their bytes.
    messages_to_store = build_messages(
        plugin_version, post_description, [f"post_image:{post_image.id}" for post_image, _ in images_with_data])

    model = configured_model()
    classification.prompt = messages_to_store
    classification.model = model
    classification.inference_source = settings.INFERENCE_SOURCE

    outcome = ask_model(messages_to_send, plugin_version, settings.INFERENCE_SOURCE, model)
    save_outcome(classification, outcome)
