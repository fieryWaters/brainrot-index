"""YouTube video transcripts, settled before a video is classified, so the
model reads what is said in the video and not only its title and thumbnail.

A video gets a transcript only when the worker downloads it itself
(YOUTUBE_SERVER_TRANSCRIPTS), and YouTube blocks the server's address after a
few dozen, so that is off, and new videos are classified at once on their
title and thumbnail.

Readers' browsers used to send transcripts: the server answered a new video
with transcript_wanted and its classifications waited up to
TRANSCRIPT_WAIT_SECONDS for a report. The extension no longer does, and no
video waits for one now, but the code that took those reports remains, and
the worker still settles any transcript left pending from that time."""

import logging
import re
import unicodedata
from datetime import timedelta

import requests
from django.db import transaction
from django.utils import timezone
from youtube_transcript_api import NoTranscriptFound, YouTubeTranscriptApi

from .models import (
    TRANSCRIPT_FETCHED,
    TRANSCRIPT_MISSING,
    TRANSCRIPT_PENDING,
    TRANSCRIPT_SOURCE_BROWSER,
    TRANSCRIPT_SOURCE_SERVER,
    VideoTranscript,
)
from .serializers import TRANSCRIPT_KIND_AUTO, TRANSCRIPT_KIND_MANUAL, TRANSCRIPT_REPORT_OK

logger = logging.getLogger(__name__)

TRANSCRIPT_REQUEST_TIMEOUT_SECONDS = 10
PREFERRED_LANGUAGES = ['en']

# How long a new video's classifications wait for a browser's transcript. A
# browser takes under a second; the rest covers its queue and the round trips.
TRANSCRIPT_WAIT_SECONDS = 5
# The model reads fewer words than this (inference.MAX_TRANSCRIPT_WORDS).
MAX_BROWSER_TRANSCRIPT_WORDS = 2500
MISSING_REASON_DEADLINE = 'No transcript arrived before the deadline'
NOT_LANGUAGE_CODE_CHARACTERS = re.compile(r'[^A-Za-z0-9-]')


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
    video_transcript.source = TRANSCRIPT_SOURCE_SERVER
    video_transcript.fetched_at = timezone.now()
    video_transcript.save()


def clean_browser_transcript(text):
    """The opening words of a transcript sent by a browser, with control and
    other invisible characters removed and all spacing made single spaces."""
    visible = ''.join(
        ' ' if unicodedata.category(character).startswith('C') else character
        for character in text
    )
    return ' '.join(visible.split()[:MAX_BROWSER_TRANSCRIPT_WORDS])


def store_browser_report(post, seen_post):
    """Stores what a reader's browser found out about a video's transcript,
    when the video is still waiting for one."""
    if seen_post['transcript_status'] == '':
        return
    with transaction.atomic():
        video_transcript = (
            VideoTranscript.objects
            .select_for_update()
            .filter(post=post, status=TRANSCRIPT_PENDING)
            .first()
        )
        if video_transcript is None:
            return
        text = clean_browser_transcript(seen_post['transcript'])
        video_transcript.source = TRANSCRIPT_SOURCE_BROWSER
        video_transcript.fetched_at = timezone.now()
        if seen_post['transcript_status'] == TRANSCRIPT_REPORT_OK and text != '':
            video_transcript.status = TRANSCRIPT_FETCHED
            video_transcript.language_code = NOT_LANGUAGE_CODE_CHARACTERS.sub('', seen_post['transcript_language'])
            if seen_post['transcript_kind'] == TRANSCRIPT_KIND_AUTO:
                video_transcript.is_generated = True
            elif seen_post['transcript_kind'] == TRANSCRIPT_KIND_MANUAL:
                video_transcript.is_generated = False
            video_transcript.snippets = [{'text': text}]
        else:
            video_transcript.status = TRANSCRIPT_MISSING
            # An "ok" report whose text was empty once cleaned counts as none.
            video_transcript.missing_reason = f"Browser reported: {seen_post['transcript_status']}"
        video_transcript.save()


def settle_overdue_transcripts():
    """Marks missing every transcript no browser reported on in time, which
    lets the video's classifications start. One UPDATE, so a report arriving
    at the same moment either lands first or finds the row no longer pending.
    Answers whether any was settled."""
    overdue_before = timezone.now() - timedelta(seconds=TRANSCRIPT_WAIT_SECONDS)
    settled_count = VideoTranscript.objects.filter(
        status=TRANSCRIPT_PENDING,
        created_at__lte=overdue_before,
    ).update(
        status=TRANSCRIPT_MISSING,
        missing_reason=MISSING_REASON_DEADLINE,
        fetched_at=timezone.now(),
    )
    return settled_count > 0
