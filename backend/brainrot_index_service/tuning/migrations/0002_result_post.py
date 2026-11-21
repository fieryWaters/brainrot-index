from django.db import migrations, models

MAX_THREAD_DEPTH = 50
PLATFORMS_BY_NAME = {'Reddit': 'reddit', 'X': 'x', 'YouTube': 'youtube'}


def reply_context(Post, post):
    """(parent_text, parent_is_reply, thread_text), as classification.inference.stored_reply_context gives them."""
    parent_post = Post.objects.filter(platform=post.platform, post_id=post.parent_post_id).first()
    if parent_post is None:
        return None, False, None
    if parent_post.kind != 'reply':
        return parent_post.text, False, None
    ancestor = parent_post
    for _ in range(MAX_THREAD_DEPTH):
        ancestor = Post.objects.filter(platform=post.platform, post_id=ancestor.parent_post_id).first()
        if ancestor is None:
            return parent_post.text, True, None
        if ancestor.kind != 'reply':
            return parent_post.text, True, ancestor.text
    return parent_post.text, True, None


def stored_post_as_read(Post, post):
    shown = {
        'platform': post.platform, 'kind': post.kind, 'author': post.author, 'community': post.community,
        'text': post.text, 'quoted_post': post.quoted_post, 'link_preview': post.link_preview,
        'parent_text': None, 'parent_is_reply': False, 'thread_text': None,
    }
    if post.kind == 'reply':
        shown['parent_text'], shown['parent_is_reply'], shown['thread_text'] = reply_context(Post, post)
    return shown


# The lines of a description (classification.inference.describe_post) that
# start a part of it, before its text and after. A part the page does not show is "skip".
PARTS_BEFORE_TEXT = {
    'Platform: ': 'platform',
    'Community: ': 'community',
    'Kind: ': 'kind',
    "The thread's post: ": 'thread_text',
    'The reply it answers: ': 'parent_reply_text',
    'The post it answers: ': 'parent_text',
    'THE ': 'skip',
    'CONTEXT, ': 'skip',
    'Images attached: ': 'skip',
    'Video': 'skip',
    'Text:': 'text',
}
PARTS_AFTER_TEXT = {
    'Quoted post, by ': 'skip',
    'Link preview': 'skip',
    'Transcript:': 'skip',
}


def description_as_read(description):
    """The post of a thumbs since deleted, or of an example gone from the
    test set, read back from its description as the model read it."""
    parts = {}
    part = 'skip'
    starts = PARTS_BEFORE_TEXT
    for line in description.split('\n'):
        prefix = next((prefix for prefix in starts if line.startswith(prefix)), None)
        if prefix is not None:
            part = starts[prefix]
            line = line[len(prefix):]
            if part == 'text':
                parts['text'] = []
                starts = PARTS_AFTER_TEXT
                continue
        if part != 'skip':
            parts.setdefault(part, []).append(line)
    found = {name: '\n'.join(lines).strip() for name, lines in parts.items()}
    text = found.get('text', '')
    if text == '(no text)':
        text = ''
    parent_text = found.get('parent_reply_text', found.get('parent_text'))
    return {
        'platform': PLATFORMS_BY_NAME.get(found.get('platform'), ''), 'kind': found.get('kind', 'post'),
        'author': '', 'community': found.get('community', ''), 'text': text, 'quoted_post': {}, 'link_preview': {},
        'parent_text': parent_text, 'parent_is_reply': 'parent_reply_text' in found,
        'thread_text': found.get('thread_text'),
    }


def fill_in_posts(apps, schema_editor):
    TuningResult = apps.get_model('tuning', 'TuningResult')
    Post = apps.get_model('classification', 'Post')
    for result in TuningResult.objects.select_related('judgment__post'):
        if result.judgment is not None:
            result.post = stored_post_as_read(Post, result.judgment.post)
        else:
            result.post = description_as_read(result.description)
        result.save(update_fields=['post'])


class Migration(migrations.Migration):

    dependencies = [
        ('tuning', '0001_experiments'),
    ]

    operations = [
        migrations.AddField(
            model_name='tuningresult',
            name='post',
            field=models.JSONField(default=dict),
        ),
        migrations.RunPython(fill_in_posts, migrations.RunPython.noop),
    ]
