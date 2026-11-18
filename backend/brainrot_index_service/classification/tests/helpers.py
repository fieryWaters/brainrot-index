import json
from unittest.mock import MagicMock

from django.contrib.auth import get_user_model

from api.auth_tokens import generate_raw_token, hash_token
from api.models import UserProfile
from classification.models import ExtensionToken

User = get_user_model()


def create_verified_user(email):
    user = User.objects.create_user(username=email, email=email, password='unused-password-123')
    UserProfile.objects.create(user=user, email_verified=True)
    return user


def create_user_with_token(email):
    user = create_verified_user(email)
    raw_token = generate_raw_token()
    ExtensionToken.objects.create(user=user, token_hash=hash_token(raw_token))
    return user, raw_token


def bearer(raw_token):
    return {'HTTP_AUTHORIZATION': f'Bearer {raw_token}'}


def seen_post(post_id, text='A photo of my garden this morning.', **overrides):
    post = {
        'platform': 'reddit',
        'kind': 'post',
        'post_id': post_id,
        'url': f'https://www.reddit.com/r/gardening/comments/{post_id}/',
        'author': 'someone',
        'community': 'r/gardening',
        'text': text,
        'image_urls': [],
    }
    post.update(overrides)
    return post


def model_response(answer):
    """A fake requests.Response from the chat completions API whose message content is answer."""
    if not isinstance(answer, str):
        answer = json.dumps(answer)
    body = {
        'choices': [{'message': {'content': answer}}],
        'usage': {'prompt_tokens': 900, 'completion_tokens': 60},
    }
    response = MagicMock()
    response.text = json.dumps(body)
    response.json.return_value = body
    response.raise_for_status.return_value = None
    return response


def fake_model_scoring(score):
    """A stand-in for requests.post that gives every post this score and the
    plugin's first label. A plugin scored by criteria takes no score from the
    model; it is told that no criterion is met, which scores 0."""
    def answer(url, **request):
        schema = request['json']['response_format']['json_schema']['schema']
        reasoning = 'The post shares a garden photo. Nothing in it fits the rubric.'
        if 'label' not in schema['properties']:
            criterion_names = [name for name in schema['properties'] if name != 'reasoning']
            criteria_answers = {name: False for name in criterion_names}
            return model_response({'reasoning': reasoning, **criteria_answers})
        first_label = schema['properties']['label']['enum'][0]
        return model_response({'reasoning': reasoning, 'score': score, 'label': first_label})
    return answer
