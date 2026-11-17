"""Taking queued work from Postgres.

Each claim locks its row with SELECT ... FOR UPDATE SKIP LOCKED and keeps the
lock until the work is saved, so concurrent workers never take the same row,
and a worker that dies mid-task simply leaves its row pending for another.
"""

import threading
import time

from django.conf import settings
from django.db import transaction

from .images import download_image
from .inference import run_classification
from .models import (
    CLASSIFICATION_PENDING,
    IMAGE_PENDING,
    PLUGIN_INPUT_VIDEO,
    TRANSCRIPT_PENDING,
    VIDEO_PENDING,
    Classification,
    PostImage,
    PostVideo,
    VideoTranscript,
)
from .transcripts import download_transcript, settle_overdue_transcripts
from .video_judging import run_video_classification
from .video_sources import DOWNLOADED_PLATFORMS, download_video, next_download_at

# At most this many transcript downloads at once, so a full YouTube page does
# not send YouTube a burst of requests from the server's address.
TRANSCRIPT_DOWNLOADS_AT_ONCE = 8
transcript_download_slots = threading.BoundedSemaphore(TRANSCRIPT_DOWNLOADS_AT_ONCE)


def download_next_pending_transcript():
    """Downloads one pending transcript. Returns False when there was none, or
    when as many transcript downloads as allowed are already running."""
    if not transcript_download_slots.acquire(blocking=False):
        return False
    try:
        with transaction.atomic():
            video_transcript = (
                VideoTranscript.objects
                .select_for_update(skip_locked=True, of=('self',))
                .filter(status=TRANSCRIPT_PENDING)
                .select_related('post')
                .order_by('id')
                .first()
            )
            if video_transcript is None:
                return False
            download_transcript(video_transcript)
        return True
    finally:
        transcript_download_slots.release()


def settle_next_transcripts():
    """Ends the wait of videos whose transcript is pending: by downloading one
    when the server fetches transcripts itself, otherwise by marking missing
    those no browser reported on in time. Returns False when there was nothing to do."""
    if settings.YOUTUBE_SERVER_TRANSCRIPTS:
        return download_next_pending_transcript()
    return settle_overdue_transcripts()


# One video download at a time per site (see video_sources).
video_download_locks = {platform: threading.Lock() for platform in DOWNLOADED_PLATFORMS}


def download_next_pending_video():
    """Downloads the opening of one pending Reddit or X video that a video
    filter is waiting on, from a site that may be asked now. Returns False when
    there was none."""
    waiting_post_ids = Classification.objects.filter(
        status=CLASSIFICATION_PENDING,
        plugin_version__plugin__input_kind=PLUGIN_INPUT_VIDEO,
    ).values('post_id')
    for platform in DOWNLOADED_PLATFORMS:
        download_lock = video_download_locks[platform]
        if not download_lock.acquire(blocking=False):
            continue
        try:
            if time.monotonic() < next_download_at[platform]:
                continue
            with transaction.atomic():
                post_video = (
                    PostVideo.objects
                    .select_for_update(skip_locked=True, of=('self',))
                    .filter(status=VIDEO_PENDING, post__platform=platform, post_id__in=waiting_post_ids)
                    .select_related('post')
                    .order_by('id')
                    .first()
                )
                if post_video is None:
                    continue
                download_video(post_video)
            return True
        finally:
            download_lock.release()
    return False


def download_next_pending_image():
    """Downloads one pending image. Returns False when there was none."""
    with transaction.atomic():
        post_image = (
            PostImage.objects
            .select_for_update(skip_locked=True)
            .filter(status=IMAGE_PENDING)
            .order_by('id')
            .first()
        )
        if post_image is None:
            return False
        download_image(post_image)
    return True


def classify_next_pending():
    """Runs one pending classification. Returns False when there was none.
    A YouTube video waits until its transcript has been fetched or found
    missing, and a video filter until the post's video has been settled."""
    with transaction.atomic():
        classification = (
            Classification.objects
            # Lock only the classification row, so other plugins can run on the same post.
            .select_for_update(skip_locked=True, of=('self',))
            .filter(status=CLASSIFICATION_PENDING)
            .exclude(post__transcript__status=TRANSCRIPT_PENDING)
            .exclude(plugin_version__plugin__input_kind=PLUGIN_INPUT_VIDEO, post__video__status=VIDEO_PENDING)
            .select_related('post', 'plugin_version__plugin')
            .order_by('id')
            .first()
        )
        if classification is None:
            return False
        if classification.plugin_version.plugin.input_kind == PLUGIN_INPUT_VIDEO:
            run_video_classification(classification)
        else:
            run_classification(classification)
    return True
