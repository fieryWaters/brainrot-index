import logging
import threading
import time
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import connection

from classification.worker import classify_next_pending, download_next_pending_image, settle_next_transcripts

logger = logging.getLogger(__name__)

# Enough requests in flight for the local model server to batch them well.
WORKER_THREADS = 48
IDLE_POLL_SECONDS = 0.2
ERROR_PAUSE_SECONDS = 1
# Touched after every successful poll; the compose healthcheck reads its age.
HEARTBEAT_PATH = Path('/tmp/classification-worker-heartbeat')


def work_forever():
    while True:
        try:
            # A video's classifications wait for its transcript, so transcripts come
            # first. Archiving an original never delays a post.
            found_work = (
                settle_next_transcripts()
                or classify_next_pending()
                or download_next_pending_image()
            )
            HEARTBEAT_PATH.touch()
        except Exception:
            # Usually the database restarting; drop the broken connection and try again.
            logger.exception("Worker loop failed")
            connection.close()
            time.sleep(ERROR_PAUSE_SECONDS)
            continue
        if not found_work:
            time.sleep(IDLE_POLL_SECONDS)


class Command(BaseCommand):
    help = "Settles video transcripts, runs pending classifications, then archives post images, 48 at a time."

    def handle(self, *args, **options):
        threads = [threading.Thread(target=work_forever, daemon=True) for _ in range(WORKER_THREADS)]
        for thread in threads:
            thread.start()
        logger.info("Classification worker started with %s threads", WORKER_THREADS)
        for thread in threads:
            thread.join()
