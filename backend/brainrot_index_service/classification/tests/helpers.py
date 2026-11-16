import json
from unittest.mock import MagicMock

from django.contrib.auth import get_user_model

from api.auth_tokens import generate_raw_token, hash_token
from classification.models import ExtensionToken

User = get_user_model()


def create_user_with_token(email):
    user = User.objects.create_user(username=email, email=email, password='unused-password-123')
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
    """A stand-in for requests.post that gives every post this score and the plugin's first label."""
    def answer(url, **request):
        schema = request['json']['response_format']['json_schema']['schema']
        first_label = schema['properties']['label']['enum'][0]
        return model_response({
            'reasoning': 'The post shares a garden photo. Nothing in it fits the rubric.',
            'score': score,
            'label': first_label,
        })
    return answer
