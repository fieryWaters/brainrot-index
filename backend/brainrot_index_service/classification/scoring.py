"""How a plugin version's answer becomes a score.

A version with criteria asks the model only whether each criterion is met.
The score is the sum of the points of the criteria met, added up here, so a
score always says which criteria the post met. The label is the met criterion
that adds the most points, or "none".

A version without criteria (the older baseline rubrics and every store plugin)
asks the model for the score and label directly, following its score bands.
"""

import json

LABEL_NO_CRITERION_MET = 'none'

SCORE_BAND_INSTRUCTIONS = """\
Classify the single post the user sends against the rubric above. Judge only
what the post itself shows. Answer with a JSON object with exactly these
fields, in this order:
- reasoning: two or three sentences explaining your judgment, written before
  you decide the score.
- score: an integer from 0 to 100, following the score bands.
- label: exactly one of: {labels}."""

CRITERIA_INSTRUCTIONS = """\
Judge the single post the user sends against each criterion below. Read it
in its context: where it is posted and what it replies to. Decide each
criterion on its own: a post can meet one and not the others. A criterion is met only when the post clearly meets
it; when in doubt, it is not met.

CRITERIA
{criteria}

Answer with a JSON object with exactly these fields, in this order:
- reasoning: one or two sentences describing what the post says or shows,
  without judging it.
- one field per criterion, named as above: true when the post meets it,
  false when it does not."""

# Only for evaluation, never in production classification: after its answers,
# the model explains each one, so a wrong answer can be traced to a criterion.
EXPLANATION_PREFIX = 'why_'
EXPLAIN_INSTRUCTIONS = """
- then, for each criterion, a field named why_ followed by the criterion's
  name: a few sentences explaining why you judged it met or not met."""


def response_instructions(plugin_version, explain=False):
    if not plugin_version.criteria:
        return SCORE_BAND_INSTRUCTIONS.format(labels=', '.join(plugin_version.allowed_labels))
    criteria_lines = [f"- {criterion['name']}: {criterion['question']}" for criterion in plugin_version.criteria]
    instructions = CRITERIA_INSTRUCTIONS.format(criteria='\n'.join(criteria_lines))
    if explain:
        instructions += EXPLAIN_INSTRUCTIONS
    return instructions


def answer_schema(plugin_version, explain=False):
    if not plugin_version.criteria:
        return {
            'type': 'object',
            'properties': {
                'reasoning': {'type': 'string'},
                'score': {'type': 'integer', 'minimum': 0, 'maximum': 100},
                'label': {'type': 'string', 'enum': plugin_version.allowed_labels},
            },
            'required': ['reasoning', 'score', 'label'],
            'additionalProperties': False,
        }
    properties = {'reasoning': {'type': 'string'}}
    for criterion in plugin_version.criteria:
        properties[criterion['name']] = {'type': 'boolean'}
    if explain:
        for criterion in plugin_version.criteria:
            properties[EXPLANATION_PREFIX + criterion['name']] = {'type': 'string'}
    return {
        'type': 'object',
        'properties': properties,
        'required': list(properties),
        'additionalProperties': False,
    }


def criteria_score(criteria, criteria_met):
    """(score, label) for the names of the criteria a post met. A criterion
    with negative points takes points off; the score stays within 0 to 100."""
    met = [criterion for criterion in criteria if criterion['name'] in criteria_met]
    score = sum(criterion['points'] for criterion in met)
    score = max(0, min(100, score))

    adding = [criterion for criterion in met if criterion['points'] > 0]
    if not adding:
        return score, LABEL_NO_CRITERION_MET
    strongest = max(adding, key=lambda criterion: criterion['points'])
    return score, strongest['name']


def parse_answer(answer_text, plugin_version, explain=False):
    """The model's answer as {reasoning, score, label, criteria_met}, or None
    when it does not match the schema. criteria_met lists the names of the
    criteria met, and is empty for a version without criteria. With explain,
    the answer also holds criteria_explanations, the model's explanation of
    each criterion by name."""
    try:
        answer = json.loads(answer_text)
    except json.JSONDecodeError:
        return None
    if not isinstance(answer, dict):
        return None
    if not isinstance(answer.get('reasoning'), str) or not answer['reasoning'].strip():
        return None

    if not plugin_version.criteria:
        if set(answer) != {'reasoning', 'score', 'label'}:
            return None
        # bool is a subclass of int, so compare the type exactly.
        if type(answer['score']) is not int or not 0 <= answer['score'] <= 100:
            return None
        if answer['label'] not in plugin_version.allowed_labels:
            return None
        answer['criteria_met'] = []
        return answer

    criterion_names = [criterion['name'] for criterion in plugin_version.criteria]
    explanation_names = []
    if explain:
        explanation_names = [EXPLANATION_PREFIX + name for name in criterion_names]
    if set(answer) != {'reasoning', *criterion_names, *explanation_names}:
        return None
    if any(type(answer[name]) is not bool for name in criterion_names):
        return None
    if any(type(answer[name]) is not str for name in explanation_names):
        return None
    criteria_met = [name for name in criterion_names if answer[name]]
    score, label = criteria_score(plugin_version.criteria, criteria_met)
    parsed = {'reasoning': answer['reasoning'], 'score': score, 'label': label, 'criteria_met': criteria_met}
    if explain:
        parsed['criteria_explanations'] = {name: answer[EXPLANATION_PREFIX + name] for name in criterion_names}
    return parsed
