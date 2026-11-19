"""The owner's inbox: every Feedback row (Feedback button, extension reports,
contact form) and every reader's thumbs up or down on a post (PostJudgment),
newest first, as plain dictionaries. The inbox page reads them through the
API and agents read them through `manage.py list_inbox`, so both see the
same fields.

Items are named by kind and id: "feedback-12", "judgment-34"."""

from django.db.models import F, Q

from classification.inference import stored_parent_text
from classification.models import IMAGE_DOWNLOADED, POST_KIND_REPLY, Classification, Post, PostJudgment
from classification.views import filter_results_for

from .models import Feedback, JudgmentResolution

KIND_FEEDBACK = 'feedback'
KIND_JUDGMENT = 'judgment'

STATUS_OPEN = 'open'
STATUS_RESOLVED = 'resolved'
STATUS_ALL = 'all'
STATUSES = [STATUS_OPEN, STATUS_RESOLVED, STATUS_ALL]


class UnknownItem(Exception):
    pass


def inbox_items(status):
    feedback_rows = Feedback.objects.select_related('user')
    judgments = PostJudgment.objects.select_related('user', 'post', 'plugin', 'resolution')
    # A judgment updated after it was resolved is open again.
    judgment_is_resolved = Q(resolution__isnull=False) & Q(resolution__resolved_at__gte=F('updated_at'))
    if status == STATUS_OPEN:
        feedback_rows = feedback_rows.filter(resolved=False)
        judgments = judgments.exclude(judgment_is_resolved)
    elif status == STATUS_RESOLVED:
        feedback_rows = feedback_rows.filter(resolved=True)
        judgments = judgments.filter(judgment_is_resolved)

    items = [feedback_item(feedback) for feedback in feedback_rows]
    items += [judgment_item(judgment) for judgment in judgments]
    items.sort(key=lambda item: item['received_at'], reverse=True)
    return items


def find_item(item_id):
    kind, _, number = item_id.partition('-')
    if not number.isdigit():
        raise UnknownItem(item_id)
    if kind == KIND_FEEDBACK:
        feedback = Feedback.objects.select_related('user').filter(id=number).first()
        if feedback is not None:
            return feedback
    if kind == KIND_JUDGMENT:
        judgment = PostJudgment.objects.select_related('user', 'post', 'plugin', 'resolution').filter(id=number).first()
        if judgment is not None:
            return judgment
    raise UnknownItem(item_id)


def item_as_dict(feedback_or_judgment):
    if isinstance(feedback_or_judgment, Feedback):
        return feedback_item(feedback_or_judgment)
    return judgment_item(feedback_or_judgment)


def resolve_item(item_id, commit, note):
    """Marks one item resolved, naming the commit that fixed it, if any."""
    found = find_item(item_id)
    if isinstance(found, Feedback):
        found.resolved = True
        found.resolved_commit = commit
        found.resolved_note = note
        found.save(update_fields=['resolved', 'resolved_commit', 'resolved_note'])
        return found
    JudgmentResolution.objects.update_or_create(
        judgment=found, defaults={'resolved_commit': commit, 'resolved_note': note})
    return find_item(item_id)


def feedback_item(feedback):
    if feedback.user is not None:
        sender_email = feedback.user.email
    else:
        sender_email = feedback.reply_email

    post = None
    filters = []
    if feedback.post_id:
        post = Post.objects.filter(platform=feedback.platform, post_id=feedback.post_id).first()
    # What the sender's filters decide about the post now; the report did not record it.
    if post is not None and feedback.user is not None:
        filters = filters_with_criteria(filter_results_for(feedback.user, post))

    return {
        'id': f"{KIND_FEEDBACK}-{feedback.id}",
        'kind': KIND_FEEDBACK,
        'received_at': feedback.created_at.isoformat(),
        'sender': {'email': sender_email, 'signed_in': feedback.user is not None, 'name': feedback.name},
        'source': feedback.source,
        'rating': feedback.rating,
        'subject': feedback.subject,
        'text': feedback.text,
        'page_url': feedback.page_url,
        'reply_email': feedback.reply_email,
        'platform': feedback.platform,
        'post_id': feedback.post_id,
        'shown_action': feedback.shown_action,
        'expected_action': feedback.expected_action,
        'site_commit': feedback.site_commit,
        'extension_commit': feedback.extension_commit,
        'post': post_as_dict(post),
        'filters': filters,
        'resolved': feedback.resolved,
        'resolved_commit': feedback.resolved_commit,
        'resolved_note': feedback.resolved_note,
    }


def judgment_item(judgment):
    resolution = getattr(judgment, 'resolution', None)
    resolved = resolution is not None and resolution.covers_current_judgment()
    if judgment.plugin is not None:
        plugin_slug = judgment.plugin.slug
    else:
        plugin_slug = ''

    return {
        'id': f"{KIND_JUDGMENT}-{judgment.id}",
        'kind': KIND_JUDGMENT,
        'received_at': judgment.updated_at.isoformat(),
        'sender': {'email': judgment.user.email, 'signed_in': True, 'name': ''},
        'verdict': judgment.verdict,
        'shown_action': judgment.shown_action,
        'plugin': plugin_slug,
        'severity': judgment.severity,
        'details': judgment.details,
        'extension_commit': judgment.extension_commit,
        'post': post_as_dict(judgment.post),
        # What every filter the reader had on decided when they judged the post.
        'filters': filters_with_criteria(judgment.filter_results),
        'resolved': resolved,
        'resolved_commit': resolution.resolved_commit if resolution is not None else '',
        'resolved_note': resolution.resolved_note if resolution is not None else '',
    }


def post_as_dict(post):
    if post is None:
        return None
    images = []
    for post_image in post.images.order_by('id'):
        # The stored copy's path on the server, for an agent that reads the file.
        if post_image.status == IMAGE_DOWNLOADED:
            file_path = post_image.file.path
        else:
            file_path = ''
        images.append({'source_url': post_image.source_url, 'status': post_image.status, 'file_path': file_path})

    post_dict = {
        'platform': post.platform,
        'post_id': post.post_id,
        'kind': post.kind,
        'url': post.url,
        'author': post.author,
        'community': post.community,
        'text': post.text,
        'parent_text': None,
        'images': images,
        'video': None,
        'transcript': None,
    }
    if post.kind == POST_KIND_REPLY:
        post_dict['parent_text'] = stored_parent_text(post)
    video = getattr(post, 'video', None)
    if video is not None:
        post_dict['video'] = {
            'source_url': video.source_url,
            'status': video.status,
            'duration_seconds': video.duration_seconds,
            'clip_path': video.clip.path if video.clip else '',
            'missing_reason': video.missing_reason,
        }
    transcript = getattr(post, 'transcript', None)
    if transcript is not None:
        post_dict['transcript'] = {
            'status': transcript.status,
            'text': transcript.text(),
            'missing_reason': transcript.missing_reason,
        }
    return post_dict


def filters_with_criteria(filter_results):
    """Each filter result with what the model said: its reasoning, the model
    that answered, and every criterion of the rubric with whether the post met it."""
    classification_ids = [result['classification_id'] for result in filter_results if result['classification_id']]
    classifications = Classification.objects.select_related('plugin_version').in_bulk(classification_ids)

    filters = []
    for result in filter_results:
        filter_dict = dict(result)
        filter_dict['reasoning'] = ''
        filter_dict['model'] = ''
        filter_dict['criteria'] = []
        classification = classifications.get(result['classification_id'])
        if classification is not None:
            plugin_version = classification.plugin_version
            filter_dict['reasoning'] = classification.reasoning
            filter_dict['model'] = classification.model
            for criterion in plugin_version.criteria:
                filter_dict['criteria'].append({
                    'name': criterion['name'],
                    'question': criterion['question'],
                    'points': criterion['points'],
                    'met': criterion['name'] in classification.criteria_met,
                })
        filters.append(filter_dict)
    return filters
