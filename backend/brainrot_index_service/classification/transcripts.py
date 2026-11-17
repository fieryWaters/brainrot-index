"""YouTube video transcripts, fetched by the worker before a video is
classified, so the model reads what is said in the video and not only its
title and thumbnail."""

import logging

import requests
from django.utils import timezone
from youtube_transcript_api import NoTranscriptFound, YouTubeTranscriptApi

from .models import TRANSCRIPT_FETCHED, TRANSCRIPT_MISSING

logger = logging.getLogger(__name__)

TRANSCRIPT_REQUEST_TIMEOUT_SECONDS = 10
PREFERRED_LANGUAGES = ['en']


class SessionWithTimeout(requests.Session):
    """A requests session whose every request gives up after a time limit.
    The transcript library sets no timeout of its own."""

    def request(self, method, url, **arguments):
        arguments.setdefault('timeout', TRANSCRIPT_REQUEST_TIMEOUT_SECONDS)
        return super().request(method, url, **arguments)


def fetch_transcript(video_id):
    """The video's transcript in English when it has one, otherwise in the
    first language YouTube lists. Raises the library's CouldNotRetrieveTranscript
    when the video has none or YouTube refuses."""
    transcript_list = YouTubeTranscriptApi(http_client=SessionWithTimeout()).list(video_id)
    try:
        transcript = transcript_list.find_transcript(PREFERRED_LANGUAGES)
    except NoTranscriptFound:
        transcript = next(iter(transcript_list))
    return transcript.fetch()


def download_transcript(video_transcript):
    """Stores the transcript of a pending VideoTranscript, or records why there is none."""
    try:
        fetched = fetch_transcript(video_transcript.post.post_id)
    # The library scrapes YouTube's pages, so any failure is possible. Every one
    # must end the wait, because the video's classifications wait for this row.
    except Exception as error:
        logger.warning("No transcript for %s: %s", video_transcript.post, type(error).__name__)
        video_transcript.status = TRANSCRIPT_MISSING
        video_transcript.missing_reason = f"{type(error).__name__}: {error}"[:2000]
    else:
        video_transcript.status = TRANSCRIPT_FETCHED
        video_transcript.language_code = fetched.language_code
        video_transcript.is_generated = fetched.is_generated
        video_transcript.snippets = fetched.to_raw_data()
    video_transcript.fetched_at = timezone.now()
    video_transcript.save()
