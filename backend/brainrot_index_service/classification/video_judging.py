"""Applying a video filter to a post's video. The model watches the video,
frames and audio, and scores each criterion of the rubric from 0 to 5; the
filter's score and label are computed here from those scores, never by the model.

The criteria are those of the owner's definition of brainrot: high engagement
power, low information content, low cognitive draw."""

import base64
import json
import logging
import time

import requests
from django.conf import settings
from django.utils import timezone

from .inference import (
    ATTEMPTS_PER_CLASSIFICATION,
    INFERENCE_SOURCE_OPENROUTER,
    OPENROUTER_BASE_URL,
    PLATFORM_NAMES,
    ModelOutcome,
)
from .models import (
    CLASSIFICATION_DONE,
    CLASSIFICATION_FAILED,
    PLATFORM_YOUTUBE,
    VIDEO_READY,
    PostVideo,
)

logger = logging.getLogger(__name__)

# Only Google AI Studio fetches YouTube videos by URL.
VIDEO_PROVIDER = 'google-ai-studio'
REQUEST_TIMEOUT_SECONDS = 180
MAX_RESPONSE_TOKENS = 600
MAX_TEXT_CHARACTERS = 2000

CRITERION_MAX = 5
ENGAGEMENT_POWER = 'engagement_power'
INFORMATION_CONTENT = 'information_content'
COGNITIVE_DRAW = 'cognitive_draw'
CRITERIA = [ENGAGEMENT_POWER, INFORMATION_CONTENT, COGNITIVE_DRAW]
MAX_POINTS = CRITERION_MAX * len(CRITERIA)
# Two thirds of the points: clearly more pull than substance.
BRAINROT_MIN_POINTS = 10
LABEL_BRAINROT = 'brainrot'
LABEL_NOT_BRAINROT = 'not_brainrot'

RESPONSE_INSTRUCTIONS = """\
Judge the video the user sends against the rubric above, from what you see and
hear in it. Answer with a JSON object with exactly these fields, in this order:
- observations: two to four sentences on what you saw and heard that decides
  the scores, written before you score.
- engagement_power, information_content, cognitive_draw: each an integer from
  0 to 5."""


def brainrot_points(answer):
    """Engagement counts for brainrot; information and cognitive draw count against it."""
    return (
        answer[ENGAGEMENT_POWER]
        + (CRITERION_MAX - answer[INFORMATION_CONTENT])
        + (CRITERION_MAX - answer[COGNITIVE_DRAW])
    )


def score_from_points(points):
    return round(points * 100 / MAX_POINTS)


def label_from_points(points):
    if points >= BRAINROT_MIN_POINTS:
        return LABEL_BRAINROT
    return LABEL_NOT_BRAINROT


def answer_schema():
    properties = {'observations': {'type': 'string'}}
    for criterion in CRITERIA:
        properties[criterion] = {'type': 'integer', 'minimum': 0, 'maximum': CRITERION_MAX}
    return {
        'type': 'object',
        'properties': properties,
        'required': ['observations'] + CRITERIA,
        'additionalProperties': False,
    }


def parse_answer(answer_text):
    """The model's answer as a dict, or None when it does not match the schema."""
    try:
        answer = json.loads(answer_text)
    except json.JSONDecodeError:
        return None

    if not isinstance(answer, dict) or set(answer) != {'observations', *CRITERIA}:
        return None
    if not isinstance(answer['observations'], str) or not answer['observations'].strip():
        return None
    for criterion in CRITERIA:
        # bool is a subclass of int, so compare the type exactly.
        if type(answer[criterion]) is not int or not 0 <= answer[criterion] <= CRITERION_MAX:
            return None
    return answer


def watched_description(post_video):
    if post_video.post.platform == PLATFORM_YOUTUBE:
        return 'the whole video'
    return f'the first {round(post_video.clip_seconds)} seconds'


def describe_video_post(post, watched):
    """The post around the video, as the model reads it."""
    lines = [f"Platform: {PLATFORM_NAMES[post.platform]}"]
    if post.community:
        lines.append(f"Community: {post.community}")
    lines.append("Text:")
    lines.append(post.text[:MAX_TEXT_CHARACTERS] or "(no text)")
    lines.append(f"Video shown: {watched}")
    return '\n'.join(lines)


def video_url_for_model(post_video):
    """The YouTube watch URL, or the kept clip as a data URL."""
    if post_video.post.platform == PLATFORM_YOUTUBE:
        return post_video.source_url
    with post_video.clip.open('rb') as clip_file:
        clip_bytes = clip_file.read()
    return 'data:video/mp4;base64,' + base64.b64encode(clip_bytes).decode('ascii')


def build_messages(rubric_prompt, post_description, video_url):
    return [
        {'role': 'system', 'content': rubric_prompt + '\n\n' + RESPONSE_INSTRUCTIONS},
        {'role': 'user', 'content': [
            {'type': 'video_url', 'video_url': {'url': video_url}},
            {'type': 'text', 'text': post_description},
        ]},
    ]


def request_video_judgment(messages, model):
    return requests.post(
        f"{OPENROUTER_BASE_URL}/chat/completions",
        json={
            'model': model,
            'messages': messages,
            'temperature': 0,
            'max_tokens': MAX_RESPONSE_TOKENS,
            'response_format': {
                'type': 'json_schema',
                'json_schema': {'name': 'video_judgment', 'strict': True, 'schema': answer_schema()},
            },
            'provider': {'only': [VIDEO_PROVIDER], 'require_parameters': True},
        },
        headers={'Authorization': f"Bearer {settings.OPENROUTER_API_KEY}"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )


def ask_model_to_watch(messages, model):
    """Sends the messages, retrying once after a failed request or an invalid
    answer, and returns a ModelOutcome."""
    outcome = ModelOutcome()
    for attempt in range(1, ATTEMPTS_PER_CLASSIFICATION + 1):
        started_at = time.monotonic()
        try:
            response = request_video_judgment(messages, model)
            outcome.latency_ms = round((time.monotonic() - started_at) * 1000)
            outcome.raw_response = response.text
            response.raise_for_status()
            completion = response.json()
            usage = completion.get('usage') or {}
            outcome.prompt_tokens = usage.get('prompt_tokens')
            outcome.completion_tokens = usage.get('completion_tokens')
            if usage.get('cost') is not None:
                outcome.cost = (outcome.cost or 0) + usage['cost']
            outcome.answer = parse_answer(completion['choices'][0]['message']['content'])
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError) as error:
            logger.warning("Video judgment attempt %s failed: %s", attempt, error)
            continue
        if outcome.answer is not None:
            break
        logger.warning("Video judgment attempt %s gave an invalid answer", attempt)
    return outcome


def judgment_reasoning(answer, points):
    return (
        f"{answer['observations']}\n\n"
        f"Engagement power {answer[ENGAGEMENT_POWER]}/5, information content {answer[INFORMATION_CONTENT]}/5, "
        f"cognitive draw {answer[COGNITIVE_DRAW]}/5: {points} of {MAX_POINTS} points."
    )


def run_video_classification(classification):
    """Watches the post's video for one pending classification and saves the
    outcome. A post whose video cannot be watched fails, and is never flagged."""
    post = classification.post
    post_video = PostVideo.objects.get(post=post)
    model = settings.VIDEO_MODEL
    classification.model = model
    classification.inference_source = INFERENCE_SOURCE_OPENROUTER

    if post_video.status != VIDEO_READY:
        classification.status = CLASSIFICATION_FAILED
        classification.reasoning = f"Video not watched: {post_video.missing_reason}"
        classification.completed_at = timezone.now()
        classification.save()
        return

    post_description = describe_video_post(post, watched_description(post_video))
    rubric_prompt = classification.plugin_version.rubric_prompt
    stored_video_url = post_video.source_url if post.platform == PLATFORM_YOUTUBE else f"post_video:{post_video.id}"
    # The stored prompt points at the kept clip instead of repeating its bytes.
    classification.prompt = build_messages(rubric_prompt, post_description, stored_video_url)

    outcome = ask_model_to_watch(build_messages(rubric_prompt, post_description, video_url_for_model(post_video)), model)
    classification.raw_response = outcome.raw_response
    classification.latency_ms = outcome.latency_ms
    classification.prompt_tokens = outcome.prompt_tokens
    classification.completion_tokens = outcome.completion_tokens

    if outcome.answer is None:
        logger.warning("Video classification %s failed", classification.id)
        classification.status = CLASSIFICATION_FAILED
    else:
        points = brainrot_points(outcome.answer)
        classification.status = CLASSIFICATION_DONE
        classification.score = score_from_points(points)
        classification.label = label_from_points(points)
        classification.reasoning = judgment_reasoning(outcome.answer, points)
    classification.completed_at = timezone.now()
    classification.save()
