"""Getting a post's video to the model.

YouTube: Gemini on Google AI Studio fetches a public video by its watch URL,
so nothing is downloaded here, and the model watches the whole video.

Reddit and X: the provider fetches only YouTube URLs, so the worker downloads
the opening VIDEO_WATCH_SECONDS of the video once, keeps that clip, and sends
it to the model inline. ffmpeg reads only as much of the stream as the clip
needs. A Reddit post's page carries its video's HLS playlist; X lists a
video's files through the public endpoint its embedded posts use.

The sites must never see a flood from the server's address: each video is
downloaded once whatever the number of readers, only while a reader's video
filter waits on it, one download at a time per site, and at most one every
VIDEO_DOWNLOAD_INTERVAL_SECONDS. A refusal (HTTP 403 or 429) pauses that
site's downloads for an hour."""

import logging
import math
import re
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from django.conf import settings
from django.core.files.base import ContentFile
from django.utils import timezone

from .models import PLATFORM_REDDIT, PLATFORM_X, VIDEO_MISSING, VIDEO_READY

logger = logging.getLogger(__name__)

# Only Reddit's video host, so a post cannot make the server fetch arbitrary URLs.
# X's video files come from its own endpoint, never from the page.
ALLOWED_REDDIT_VIDEO_HOST_SUFFIX = 'v.redd.it'
ALLOWED_X_VIDEO_HOST = 'video.twimg.com'
X_EMBED_ENDPOINT = 'https://cdn.syndication.twimg.com/tweet-result'
DOWNLOADED_PLATFORMS = [PLATFORM_REDDIT, PLATFORM_X]

REQUEST_TIMEOUT_SECONDS = 15
DOWNLOAD_HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; BrainrotIndex/1.0)'}
FFMPEG_TIMEOUT_SECONDS = 120
FFMPEG_READ_TIMEOUT_MICROSECONDS = 15_000_000
MAX_CLIP_BYTES = 50 * 1024 * 1024
REFUSAL_STATUS_CODES = {403, 429}
PAUSE_AFTER_REFUSAL_SECONDS = 3600

# When each site may next be asked for a video, on time.monotonic()'s clock.
# The worker is one process, so this is shared by all its threads.
next_download_at = {platform: 0.0 for platform in DOWNLOADED_PLATFORMS}

HLS_ATTRIBUTE = re.compile(r'([A-Z0-9-]+)=("[^"]*"|[^,]*)')


class SiteRefused(Exception):
    """The site answered a request with a refusal."""


class VideoUnavailable(Exception):
    """The video cannot be had, for a reason that does not concern the site's patience."""


def reddit_video_url_is_allowed(url):
    parsed_url = urlparse(url)
    host = (parsed_url.hostname or '').lower()
    if parsed_url.scheme != 'https':
        return False
    return host == ALLOWED_REDDIT_VIDEO_HOST_SUFFIX or host.endswith('.' + ALLOWED_REDDIT_VIDEO_HOST_SUFFIX)


def is_youtube_short(url):
    return urlparse(url).path.startswith('/shorts/')


def youtube_video_status(watch_url, duration_seconds):
    """(status, missing_reason) of a YouTube video, decided without any request:
    the model watches a video whole, so one longer than VIDEO_MAX_YOUTUBE_SECONDS
    is not watched. A Short's tile shows no length; Shorts are short."""
    if duration_seconds is None:
        if is_youtube_short(watch_url):
            return VIDEO_READY, ''
        return VIDEO_MISSING, 'The page showed no length, as for a live stream'
    if duration_seconds > settings.VIDEO_MAX_YOUTUBE_SECONDS:
        return VIDEO_MISSING, f'Longer than {settings.VIDEO_MAX_YOUTUBE_SECONDS} seconds'
    return VIDEO_READY, ''


def get_from_site(url, **arguments):
    response = requests.get(
        url, timeout=REQUEST_TIMEOUT_SECONDS, allow_redirects=False, headers=DOWNLOAD_HEADERS, **arguments)
    if response.status_code in REFUSAL_STATUS_CODES:
        raise SiteRefused(f'HTTP {response.status_code} from {urlparse(url).hostname}')
    if response.status_code != 200:
        raise VideoUnavailable(f'HTTP {response.status_code} from {urlparse(url).hostname}')
    return response


def hls_attributes(tag_line):
    attributes = {}
    for name, value in HLS_ATTRIBUTE.findall(tag_line.split(':', 1)[1]):
        attributes[name] = value.strip('"')
    return attributes


def hls_stream_urls(master_url):
    """The playlists ffmpeg reads for a Reddit video: the smallest video
    variant and its audio, when it has audio. The model sees every video at the
    same low resolution, so a larger variant would only cost more bytes."""
    playlist_lines = get_from_site(master_url).text.splitlines()

    audio_url_by_group = {}
    variants = []
    for index, line in enumerate(playlist_lines):
        if line.startswith('#EXT-X-MEDIA:'):
            attributes = hls_attributes(line)
            if attributes.get('TYPE') == 'AUDIO' and 'URI' in attributes:
                audio_url_by_group[attributes.get('GROUP-ID')] = urljoin(master_url, attributes['URI'])
        if line.startswith('#EXT-X-STREAM-INF:'):
            attributes = hls_attributes(line)
            variants.append({
                'bandwidth': int(attributes.get('BANDWIDTH', '0')),
                'audio_group': attributes.get('AUDIO'),
                'url': urljoin(master_url, playlist_lines[index + 1].strip()),
            })

    if not variants:
        raise VideoUnavailable('The playlist lists no video')
    smallest = min(variants, key=lambda variant: variant['bandwidth'])
    stream_urls = [smallest['url']]
    if smallest['audio_group'] in audio_url_by_group:
        stream_urls.append(audio_url_by_group[smallest['audio_group']])
    for stream_url in stream_urls:
        if not reddit_video_url_is_allowed(stream_url):
            raise VideoUnavailable('The playlist points off Reddit')
    return stream_urls


def base_36(number):
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    whole = int(number)
    fraction = number - whole
    whole_digits = ''
    while whole > 0:
        whole_digits = digits[whole % 36] + whole_digits
        whole = whole // 36
    fraction_digits = ''
    for _ in range(12):
        fraction = fraction * 36
        fraction_digits = fraction_digits + digits[int(fraction)]
        fraction = fraction - int(fraction)
    return (whole_digits or '0') + '.' + fraction_digits


def x_embed_token(post_id):
    """The token X's embed widget sends with a post id: id / 1e15 * pi in base
    36, without its zeros and its point."""
    return re.sub(r'0+|\.', '', base_36(int(post_id) / 1e15 * math.pi))


def x_video_file(post_id):
    """(URL, length in seconds) of the smallest MP4 file of the post's video."""
    response = get_from_site(X_EMBED_ENDPOINT, params={'id': post_id, 'token': x_embed_token(post_id)})
    for media in response.json().get('mediaDetails', []):
        video_info = media.get('video_info')
        if video_info is None:
            continue
        mp4_variants = [
            variant for variant in video_info.get('variants', [])
            if variant.get('content_type') == 'video/mp4' and urlparse(variant.get('url', '')).hostname == ALLOWED_X_VIDEO_HOST
        ]
        if not mp4_variants:
            continue
        smallest = min(mp4_variants, key=lambda variant: variant.get('bitrate') or 0)
        duration_seconds = None
        if video_info.get('duration_millis') is not None:
            duration_seconds = round(video_info['duration_millis'] / 1000)
        return smallest['url'], duration_seconds
    raise VideoUnavailable('X lists no video file for this post')


def cut_clip(stream_urls, seconds):
    """(MP4 bytes, length in seconds) of the first seconds of the video, from a
    video stream and an optional separate audio stream, copied without
    re-encoding."""
    with tempfile.TemporaryDirectory() as work_directory:
        clip_path = Path(work_directory) / 'clip.mp4'
        command = ['ffmpeg', '-nostdin', '-loglevel', 'error']
        for stream_url in stream_urls:
            # Network protocols only, so a playlist can never point ffmpeg at a local file.
            command += [
                '-protocol_whitelist', 'https,tls,tcp,crypto',
                '-rw_timeout', str(FFMPEG_READ_TIMEOUT_MICROSECONDS),
                '-i', stream_url,
            ]
        if len(stream_urls) == 2:
            command += ['-map', '0:v:0', '-map', '1:a:0']
        else:
            command += ['-map', '0:v:0', '-map', '0:a:0?']
        command += ['-t', str(seconds), '-c', 'copy', '-movflags', '+faststart', '-fs', str(MAX_CLIP_BYTES), str(clip_path)]

        try:
            finished = subprocess.run(command, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            raise VideoUnavailable('ffmpeg took too long')
        if finished.returncode != 0:
            error_text = finished.stderr.strip()[-500:]
            # ffmpeg names 403 but reports 429 only as "4XX", so every unnamed 4xx counts as a refusal.
            if '403 Forbidden' in error_text or '4XX' in error_text:
                raise SiteRefused(error_text)
            raise VideoUnavailable(f'ffmpeg failed: {error_text}')
        return clip_path.read_bytes(), clip_duration_seconds(clip_path)


def clip_duration_seconds(clip_path):
    probed = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(clip_path)],
        capture_output=True, text=True, timeout=30,
    )
    return float(probed.stdout.strip())


def download_video(post_video):
    """Downloads the opening of a pending Reddit or X video and keeps it, or
    records why it cannot be watched, and sets when that site may next be asked."""
    post = post_video.post
    try:
        if post.platform == PLATFORM_REDDIT:
            stream_urls = hls_stream_urls(post_video.source_url)
        else:
            video_file_url, post_video.duration_seconds = x_video_file(post.post_id)
            stream_urls = [video_file_url]
        clip_bytes, post_video.clip_seconds = cut_clip(stream_urls, settings.VIDEO_WATCH_SECONDS)
    except SiteRefused as refusal:
        logger.warning("%s refused a video download; pausing its downloads: %s", post.platform, refusal)
        next_download_at[post.platform] = time.monotonic() + PAUSE_AFTER_REFUSAL_SECONDS
        post_video.status = VIDEO_MISSING
        post_video.missing_reason = f'Site refused: {refusal}'[:2000]
    # Anything can fail on the way, and every failure must end the wait, because
    # the video's classifications wait for this row.
    except Exception as error:
        logger.warning("No video for %s: %s", post, type(error).__name__)
        next_download_at[post.platform] = time.monotonic() + settings.VIDEO_DOWNLOAD_INTERVAL_SECONDS
        post_video.status = VIDEO_MISSING
        post_video.missing_reason = f'{type(error).__name__}: {error}'[:2000]
    else:
        next_download_at[post.platform] = time.monotonic() + settings.VIDEO_DOWNLOAD_INTERVAL_SECONDS
        post_video.clip.save(f'{post.platform}-{post.post_id}.mp4', ContentFile(clip_bytes), save=False)
        post_video.clip_bytes = len(clip_bytes)
        post_video.status = VIDEO_READY
    post_video.settled_at = timezone.now()
    post_video.save()
