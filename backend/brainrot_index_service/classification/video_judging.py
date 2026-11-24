"""Judging a post with its video watched: the same instructions and answer as
for any post, with the video's opening, frames and audio, attached to the
post's text and images. A rubric's classification and a feature scoring both
watch this way. Only Gemini watches videos.

With GEMINI_API_KEY set, the video goes straight to the Gemini API, which can
clip a YouTube video, so only its first VIDEO_WATCH_SECONDS are watched and
billed. Without it, the video goes through OpenRouter, which cannot clip, so a
YouTube video is watched whole."""

import base64
import logging
import time

import requests
from django.conf import settings

from .inference import (
    ATTEMPTS_PER_CLASSIFICATION,
    INFERENCE_SOURCE_OPENROUTER,
    OPENROUTER_BASE_URL,
    ModelOutcome,
    describe_stored_post,
    images_for_model,
    save_outcome,
    system_prompt,
)
from .models import PLATFORM_YOUTUBE
from .scoring import answer_schema, parse_answer

logger = logging.getLogger(__name__)

# Only Google AI Studio fetches YouTube videos by URL.
VIDEO_PROVIDER = 'google-ai-studio'
GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
INFERENCE_SOURCE_GEMINI = 'gemini'
REQUEST_TIMEOUT_SECONDS = 180
MAX_RESPONSE_TOKENS = 600
DATA_URL_BASE64_MARKER = ';base64,'


def watches_through_gemini():
    return settings.GEMINI_API_KEY != ''


def watched_description(post_video):
    """How much of the video the model is shown, in the words the prompt uses."""
    if post_video.post.platform != PLATFORM_YOUTUBE:
        return f'the first {round(post_video.clip_seconds)} seconds'
    if not watches_through_gemini():
        return 'the whole video'
    if post_video.duration_seconds is not None and post_video.duration_seconds <= settings.VIDEO_WATCH_SECONDS:
        return 'the whole video'
    return f'the first {settings.VIDEO_WATCH_SECONDS} seconds'


def clip_base64(post_video):
    with post_video.clip.open('rb') as clip_file:
        return base64.b64encode(clip_file.read()).decode('ascii')


# -- Through OpenRouter: a YouTube URL, watched whole, or the clip as a data URL --


def openrouter_video_url(post_video, stored):
    if post_video.post.platform == PLATFORM_YOUTUBE:
        return post_video.source_url
    if stored:
        return f"post_video:{post_video.id}"
    return 'data:video/mp4;base64,' + clip_base64(post_video)


def build_messages(system_text, post_description, video_url, image_urls):
    user_content = [
        {'type': 'video_url', 'video_url': {'url': video_url}},
        {'type': 'text', 'text': post_description},
    ]
    for image_url in image_urls:
        user_content.append({'type': 'image_url', 'image_url': {'url': image_url}})
    return [
        {'role': 'system', 'content': system_text},
        {'role': 'user', 'content': user_content},
    ]


def send_to_openrouter(messages, schema_name, schema, model):
    return requests.post(
        f"{OPENROUTER_BASE_URL}/chat/completions",
        json={
            'model': model,
            'messages': messages,
            'temperature': 0,
            'max_tokens': MAX_RESPONSE_TOKENS,
            'response_format': {
                'type': 'json_schema',
                'json_schema': {'name': schema_name, 'strict': True, 'schema': schema},
            },
            'provider': {'only': [VIDEO_PROVIDER], 'require_parameters': True, 'data_collection': 'deny'},
        },
        headers={'Authorization': f"Bearer {settings.OPENROUTER_API_KEY}"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


def read_openrouter_completion(completion):
    """(answer text, prompt tokens, cached prompt tokens, completion tokens, cost) of an OpenRouter answer."""
    usage = completion.get('usage') or {}
    return (
        completion['choices'][0]['message']['content'],
        usage.get('prompt_tokens'),
        (usage.get('prompt_tokens_details') or {}).get('cached_tokens'),
        usage.get('completion_tokens'),
        usage.get('cost'),
    )


# -- Straight to Gemini: a YouTube URL clipped to its opening, or the clip inline --


def gemini_video_part(post_video, stored):
    if post_video.post.platform == PLATFORM_YOUTUBE:
        return {
            'fileData': {'fileUri': post_video.source_url},
            'videoMetadata': {'startOffset': '0s', 'endOffset': f'{settings.VIDEO_WATCH_SECONDS}s'},
        }
    if stored:
        return {'inlineData': {'mimeType': 'video/mp4', 'data': f"post_video:{post_video.id}"}}
    return {'inlineData': {'mimeType': 'video/mp4', 'data': clip_base64(post_video)}}


def gemini_image_part(image_url):
    """An image for Gemini, inline: the base64 data of a JPEG data URL, or a
    stored image's "post_image:<id>" reference, which has no data URL prefix."""
    image_data = image_url.split(DATA_URL_BASE64_MARKER, 1)[-1]
    return {'inlineData': {'mimeType': 'image/jpeg', 'data': image_data}}


def build_gemini_request(system_text, schema, post_description, video_part, image_urls):
    parts = [video_part, {'text': post_description}]
    for image_url in image_urls:
        parts.append(gemini_image_part(image_url))
    return {
        'systemInstruction': {'parts': [{'text': system_text}]},
        'contents': [{'role': 'user', 'parts': parts}],
        'generationConfig': {
            'temperature': 0,
            'maxOutputTokens': MAX_RESPONSE_TOKENS,
            'responseMimeType': 'application/json',
            'responseJsonSchema': schema,
        },
    }


def send_to_gemini(request_body, model):
    return requests.post(
        f"{GEMINI_BASE_URL}/models/{model}:generateContent",
        json=request_body,
        headers={'x-goog-api-key': settings.GEMINI_API_KEY},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


def read_gemini_completion(completion):
    """(answer text, prompt tokens, cached prompt tokens, completion tokens, cost)
    of a Gemini answer. Gemini reports no cost; thinking tokens are billed as
    output, so they count as completion tokens."""
    usage = completion.get('usageMetadata') or {}
    completion_tokens = (usage.get('candidatesTokenCount') or 0) + (usage.get('thoughtsTokenCount') or 0)
    return (
        completion['candidates'][0]['content']['parts'][0]['text'],
        usage.get('promptTokenCount'),
        usage.get('cachedContentTokenCount'),
        completion_tokens,
        None,
    )


def ask_model_to_watch(send, read_completion, parse):
    """Calls send() for the model's answer, retrying once after a failed request
    or an answer parse rejects, and returns a ModelOutcome whose answer is
    what parse made of the model's text."""
    outcome = ModelOutcome()
    for attempt in range(1, ATTEMPTS_PER_CLASSIFICATION + 1):
        started_at = time.monotonic()
        try:
            response = send()
            outcome.latency_ms = round((time.monotonic() - started_at) * 1000)
            outcome.raw_response = response.text
            response.raise_for_status()
            (answer_text, outcome.prompt_tokens, outcome.cached_prompt_tokens,
             outcome.completion_tokens, cost) = read_completion(response.json())
            if cost is not None:
                outcome.cost = (outcome.cost or 0) + cost
            outcome.answer = parse(answer_text)
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
            logger.warning("Video judgment attempt %s failed: %s", attempt, error)
            continue
        if outcome.answer is not None:
            break
        logger.warning("Video judgment attempt %s gave an invalid answer", attempt)
    return outcome


def watch_and_answer(post, post_video, system_text, schema_name, schema, parse):
    """Asks the video model about a post with its ready video attached.
    Returns (outcome, model, inference source, the prompt to store), the
    stored prompt pointing at the kept clip and images instead of repeating
    their bytes."""
    images_with_data = images_for_model(post)
    post_description = describe_stored_post(post, len(images_with_data), watched_description(post_video))
    image_urls_to_send = [data_url for _, data_url in images_with_data]
    image_urls_to_store = [f"post_image:{post_image.id}" for post_image, _ in images_with_data]

    if watches_through_gemini():
        model = settings.VIDEO_GEMINI_MODEL
        prompt_to_store = build_gemini_request(
            system_text, schema, post_description, gemini_video_part(post_video, stored=True), image_urls_to_store)
        request_body = build_gemini_request(
            system_text, schema, post_description, gemini_video_part(post_video, stored=False), image_urls_to_send)
        outcome = ask_model_to_watch(lambda: send_to_gemini(request_body, model), read_gemini_completion, parse)
        return outcome, model, INFERENCE_SOURCE_GEMINI, prompt_to_store

    model = settings.VIDEO_MODEL
    prompt_to_store = build_messages(
        system_text, post_description, openrouter_video_url(post_video, stored=True), image_urls_to_store)
    messages = build_messages(
        system_text, post_description, openrouter_video_url(post_video, stored=False), image_urls_to_send)
    outcome = ask_model_to_watch(
        lambda: send_to_openrouter(messages, schema_name, schema, model), read_openrouter_completion, parse)
    return outcome, model, INFERENCE_SOURCE_OPENROUTER, prompt_to_store


def run_video_classification(classification, post_video):
    """Judges a post with its ready video attached, for one pending
    classification, and saves the outcome."""
    plugin_version = classification.plugin_version
    outcome, classification.model, classification.inference_source, classification.prompt = watch_and_answer(
        classification.post, post_video, system_prompt(plugin_version), 'classification',
        answer_schema(plugin_version), lambda answer_text: parse_answer(answer_text, plugin_version))
    save_outcome(classification, outcome)
