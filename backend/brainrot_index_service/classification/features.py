"""Filters as compositions of scored features.

The model does not judge each filter. It rates a few shared features of a
post, each from 0 to 10, in one call. A feature is described by its levels,
from least to most, written evenly spaced in meaning; level i of N sits at
10 * i / (N - 1). The model may answer any whole number, so a post between
two levels lands between their points.

A filter is a formula over the feature scores, scaled to 0 to 100, with a
cutoff: a product of features, for a concept that needs all of them (empty
and stimulating), or a weighted sum, each feature times a multiplier."""

import json

from django.conf import settings
from django.utils import timezone

from .inference import (
    MAX_RESPONSE_TOKENS,
    ask_for_answer,
    chat_messages,
    configured_model,
    describe_stored_post,
    images_for_model,
)
from .models import CLASSIFICATION_DONE, CLASSIFICATION_FAILED

LOWEST_RATING = 0
HIGHEST_RATING = 10
HIGHEST_FILTER_SCORE = 100

FORM_PRODUCT = 'product'
FORM_WEIGHTED_SUM = 'weighted_sum'
FORMS = [FORM_PRODUCT, FORM_WEIGHTED_SUM]

FEATURE_INSTRUCTIONS = """\
You rate one social media post or reply on each feature below. A feature is a
scale from 0 to 10. Its levels are described from least to most, each at the
point shown; a post that falls between two levels gets a number between their
points. Rate each feature on its own, as a whole number from 0 to 10, by what
the post shows: a post can be high on one feature and low on another.

Rate only the post or reply marked as being judged. Anything marked as
context, such as the post a reply answers, is there to help you read it and
is never rated itself.

FEATURES

{features}

Answer with a JSON object with one field per feature, named as above, holding
its rating."""


def level_point(index, level_count):
    return HIGHEST_RATING * index / (level_count - 1)


def point_text(point):
    """"5" for a whole point, "3.3" otherwise."""
    if point == int(point):
        return str(int(point))
    return f"{point:.1f}"


def feature_text(feature):
    lines = [f"{feature['name']}: {feature['description']}"]
    level_count = len(feature['levels'])
    for index, level in enumerate(feature['levels']):
        lines.append(f"  {point_text(level_point(index, level_count))}: {level['text']}")
        for example in level['examples']:
            lines.append(f"     For example: {example}")
    return '\n'.join(lines)


def features_prompt(features):
    """The fixed instructions, identical for every post a feature set rates."""
    return FEATURE_INSTRUCTIONS.format(features='\n\n'.join(feature_text(feature) for feature in features))


def scores_schema(features):
    properties = {
        feature['name']: {'type': 'integer', 'minimum': LOWEST_RATING, 'maximum': HIGHEST_RATING}
        for feature in features
    }
    return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}


def parse_scores(answer_text, features):
    """{feature name: rating} from the model's answer, or None when it does not match the schema."""
    try:
        answer = json.loads(answer_text)
    except json.JSONDecodeError:
        return None
    names = [feature['name'] for feature in features]
    if not isinstance(answer, dict) or set(answer) != set(names):
        return None
    for name in names:
        # bool is a subclass of int, so compare the type exactly.
        if type(answer[name]) is not int or not LOWEST_RATING <= answer[name] <= HIGHEST_RATING:
            return None
    return {name: answer[name] for name in names}


def ask_feature_scores(messages, features, inference_source, model):
    """A ModelOutcome whose answer is {feature name: rating}."""
    return ask_for_answer(
        messages, 'feature_scores', scores_schema(features),
        lambda answer_text: parse_scores(answer_text, features),
        inference_source, model, MAX_RESPONSE_TOKENS)


def filter_score(filter_definition, scores):
    """A filter's score from 0 to 100. A product multiplies its features, each
    taken as a fraction of 10, so it is high only when all of them are. A
    weighted sum adds each feature times its multiplier, kept within 0 to 100."""
    if filter_definition['form'] == FORM_PRODUCT:
        product = HIGHEST_FILTER_SCORE
        for name in filter_definition['features']:
            product = product * scores[name] / HIGHEST_RATING
        return round(product, 1)
    total = sum(weight * scores[name] for name, weight in filter_definition['weights'].items())
    return round(max(0, min(HIGHEST_FILTER_SCORE, total)), 1)


def features_used(filter_definition):
    if filter_definition['form'] == FORM_PRODUCT:
        return list(filter_definition['features'])
    return list(filter_definition['weights'])


def run_feature_scoring(post_feature_scores):
    """Calls the model for one pending PostFeatureScores and saves the outcome,
    as run_classification does for a classification."""
    features = post_feature_scores.feature_set.features
    post = post_feature_scores.post
    images_with_data = images_for_model(post)
    post_description = describe_stored_post(post, len(images_with_data))
    system_text = features_prompt(features)
    messages_to_send = chat_messages(system_text, post_description, [data_url for _, data_url in images_with_data])
    # The stored prompt points at the stored images instead of repeating their bytes.
    messages_to_store = chat_messages(
        system_text, post_description, [f"post_image:{post_image.id}" for post_image, _ in images_with_data])

    model = configured_model()
    outcome = ask_feature_scores(messages_to_send, features, settings.INFERENCE_SOURCE, model)

    post_feature_scores.prompt = messages_to_store
    post_feature_scores.model = model
    post_feature_scores.inference_source = settings.INFERENCE_SOURCE
    post_feature_scores.raw_response = outcome.raw_response
    post_feature_scores.latency_ms = outcome.latency_ms
    post_feature_scores.prompt_tokens = outcome.prompt_tokens
    post_feature_scores.cached_prompt_tokens = outcome.cached_prompt_tokens
    post_feature_scores.completion_tokens = outcome.completion_tokens
    if outcome.answer is None:
        post_feature_scores.status = CLASSIFICATION_FAILED
    else:
        post_feature_scores.status = CLASSIFICATION_DONE
        post_feature_scores.scores = outcome.answer
    post_feature_scores.completed_at = timezone.now()
    post_feature_scores.save()
