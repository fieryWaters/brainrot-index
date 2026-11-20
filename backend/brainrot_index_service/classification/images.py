"""Post images: small copies for the model, fetched when a post is classified,
and the originals, downloaded afterwards for the archive."""

import base64
import io
import logging
import mimetypes
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import requests
from django.core.files.base import ContentFile
from PIL import Image

from .models import IMAGE_DOWNLOADED, IMAGE_FAILED, IMAGE_REJECTED

logger = logging.getLogger(__name__)

# Only the platforms' own media hosts, so a post cannot make the server fetch arbitrary URLs.
ALLOWED_IMAGE_HOST_SUFFIXES = ['redd.it', 'redditmedia.com', 'twimg.com', 'ytimg.com']
IMAGE_DOWNLOAD_TIMEOUT_SECONDS = 10
MAX_IMAGE_BYTES = 20 * 1024 * 1024
DOWNLOAD_CHUNK_BYTES = 256 * 1024
DOWNLOAD_HEADERS = {'User-Agent': 'Mozilla/5.0 (compatible; BrainrotIndex/1.0)'}

# Small enough to keep model calls cheap, large enough that the text in a phone
# screenshot stays readable: the shorter side at most 768 pixels, the longer at most 2048.
MODEL_IMAGE_SHORT_SIDE = 768
MODEL_IMAGE_LONG_SIDE = 2048
MODEL_IMAGE_JPEG_QUALITY = 85


def image_url_is_allowed(url):
    parsed_url = urlparse(url)
    if parsed_url.scheme != 'https':
        return False

    host = (parsed_url.hostname or '').lower()
    for allowed_suffix in ALLOWED_IMAGE_HOST_SUFFIXES:
        if host == allowed_suffix or host.endswith('.' + allowed_suffix):
            return True
    return False


def fetch_image(url):
    """The image's bytes and content type, or None when it cannot be fetched
    within the time and size limits. Redirects are not followed, since they
    could lead off the allowed hosts."""
    try:
        with requests.get(
            url,
            stream=True,
            timeout=IMAGE_DOWNLOAD_TIMEOUT_SECONDS,
            allow_redirects=False,
            headers=DOWNLOAD_HEADERS,
        ) as response:
            if response.status_code != 200:
                logger.warning("Image download got HTTP %s: %s", response.status_code, url)
                return None

            image_bytes = bytearray()
            for chunk in response.iter_content(DOWNLOAD_CHUNK_BYTES):
                image_bytes.extend(chunk)
                if len(image_bytes) > MAX_IMAGE_BYTES:
                    logger.warning("Image larger than %s bytes: %s", MAX_IMAGE_BYTES, url)
                    return None
            content_type = response.headers.get('Content-Type', '')
    except requests.RequestException as error:
        logger.warning("Image download failed: %s (%s)", url, error)
        return None

    return bytes(image_bytes), content_type


def download_image(post_image):
    """Stores the original bytes of a pending PostImage and records the outcome."""
    if not image_url_is_allowed(post_image.source_url):
        post_image.status = IMAGE_REJECTED
        post_image.save(update_fields=['status'])
        return

    fetched = fetch_image(post_image.source_url)
    if fetched is None:
        post_image.status = IMAGE_FAILED
        post_image.save(update_fields=['status'])
        return

    image_bytes, content_type = fetched
    file_extension = mimetypes.guess_extension(content_type.split(';')[0].strip()) or ''
    post_image.file.save(f"{post_image.id}{file_extension}", ContentFile(image_bytes), save=False)
    post_image.byte_size = len(image_bytes)
    post_image.status = IMAGE_DOWNLOADED
    post_image.save(update_fields=['file', 'byte_size', 'status'])


def model_rendition_url(url):
    """A URL of the image small enough for the model. X photos come in sizes
    chosen by the "name" parameter, and the extension asks for "orig", often
    several megabytes, so the model gets "medium" (at most 1200 pixels) instead. Other URLs are used
    as sent: Reddit's resized copies are signed URLs that cannot be derived
    from the original."""
    parsed_url = urlparse(url)
    if parsed_url.hostname != 'pbs.twimg.com' or not parsed_url.path.startswith('/media/'):
        return url
    query = dict(parse_qsl(parsed_url.query))
    query['name'] = 'medium'
    return urlunparse(parsed_url._replace(query=urlencode(query)))


def model_image_data_url(post_image):
    """The image for the model as a JPEG data URL, or None when it cannot be
    had: the archived original when it is stored already, otherwise a small
    rendition fetched now, so classification never waits for the archive."""
    if post_image.status == IMAGE_DOWNLOADED:
        return stored_image_data_url(post_image)

    fetched = fetch_image(model_rendition_url(post_image.source_url))
    if fetched is None:
        return None
    image_bytes, _ = fetched
    try:
        return image_file_data_url(io.BytesIO(image_bytes))
    except OSError as error:
        logger.warning("Cannot decode the model rendition of post image %s: %s", post_image.id, error)
        return None


def stored_image_data_url(post_image):
    """The stored original as a JPEG data URL of the model's size, or None when
    the stored bytes are not an image Pillow can read."""
    try:
        with post_image.file.open('rb') as image_file:
            return image_file_data_url(image_file)
    except OSError as error:
        logger.warning("Cannot decode post image %s: %s", post_image.id, error)
        return None


def image_file_data_url(image_file):
    """An image file (a path or an open binary file) as a JPEG data URL,
    shrunk to MODEL_IMAGE_SHORT_SIDE and MODEL_IMAGE_LONG_SIDE. Raises OSError
    when the bytes are not an image Pillow can read."""
    with Image.open(image_file) as picture:
        small_picture = picture.convert('RGB')
        short_side = min(small_picture.size)
        long_side = max(small_picture.size)
        scale = min(1, MODEL_IMAGE_SHORT_SIDE / short_side, MODEL_IMAGE_LONG_SIDE / long_side)
        small_picture.thumbnail((round(small_picture.width * scale), round(small_picture.height * scale)))
        jpeg_buffer = io.BytesIO()
        small_picture.save(jpeg_buffer, format='JPEG', quality=MODEL_IMAGE_JPEG_QUALITY)

    encoded_jpeg = base64.b64encode(jpeg_buffer.getvalue()).decode('ascii')
    return f"data:image/jpeg;base64,{encoded_jpeg}"
