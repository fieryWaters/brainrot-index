"""Taking queued work from Postgres.

Each claim locks its row with SELECT ... FOR UPDATE SKIP LOCKED and keeps the
lock until the work is saved, so concurrent workers never take the same row,
and a worker that dies mid-task simply leaves its row pending for another.
"""

from django.db import transaction

from .images import download_image
from .inference import run_classification
from .models import CLASSIFICATION_PENDING, IMAGE_PENDING, Classification, PostImage


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
    """Runs one pending classification. Returns False when there was none."""
    with transaction.atomic():
        classification = (
            Classification.objects
            # Lock only the classification row, so other plugins can run on the same post.
            .select_for_update(skip_locked=True, of=('self',))
            .filter(status=CLASSIFICATION_PENDING)
            .select_related('post', 'plugin_version')
            .order_by('id')
            .first()
        )
        if classification is None:
            return False
        run_classification(classification)
    return True
