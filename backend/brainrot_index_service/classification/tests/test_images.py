import tempfile
from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings

from classification.images import MAX_IMAGE_BYTES, download_image, image_url_is_allowed, model_rendition_url
from classification.models import IMAGE_FAILED, IMAGE_REJECTED, PostImage
from classification.views import store_post

from .helpers import seen_post


class ImageHostAllowlistTests(TestCase):
    def test_platform_media_hosts_are_allowed(self):
        for url in [
            'https://i.redd.it/abc.jpg',
            'https://preview.redd.it/abc.png?width=640',
            'https://external-preview.redd.it/abc.jpg',
            'https://b.thumbs.redditmedia.com/abc.jpg',
            'https://pbs.twimg.com/media/ABC?format=jpg&name=small',
            'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        ]:
            self.assertTrue(image_url_is_allowed(url), url)

    def test_other_hosts_and_plain_http_are_rejected(self):
        for url in [
            'http://i.redd.it/abc.jpg',
            'https://evilredd.it/abc.jpg',
            'https://i.redd.it.evil.com/abc.jpg',
            'https://example.com/abc.jpg',
            'https://169.254.169.254/latest/meta-data',
            'file:///etc/passwd',
        ]:
            self.assertFalse(image_url_is_allowed(url), url)


class ModelRenditionTests(TestCase):
    def test_x_photos_are_fetched_at_medium_size(self):
        self.assertEqual(
            model_rendition_url('https://pbs.twimg.com/media/ABC?format=jpg&name=orig'),
            'https://pbs.twimg.com/media/ABC?format=jpg&name=medium',
        )

    def test_other_urls_are_used_as_sent(self):
        for url in [
            'https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/ABC.jpg',
            'https://i.redd.it/abc.jpg',
            'https://preview.redd.it/abc.png?width=1080&s=signature',
        ]:
            self.assertEqual(model_rendition_url(url), url)


@override_settings(MEDIA_ROOT=tempfile.mkdtemp())
class ImageDownloadTests(TestCase):
    def pending_image(self, url):
        post = store_post(seen_post('p1', image_urls=[url]))
        return PostImage.objects.get(post=post)

    def test_disallowed_host_is_never_fetched(self):
        # store_post drops such URLs; images stored before that still exist.
        post = store_post(seen_post('p1'))
        post_image = PostImage.objects.create(post=post, source_url='https://example.com/abc.jpg')
        with patch('classification.images.requests.get') as fetch:
            download_image(post_image)
        fetch.assert_not_called()
        self.assertEqual(post_image.status, IMAGE_REJECTED)

    def test_image_over_20_megabytes_fails(self):
        post_image = self.pending_image('https://i.redd.it/huge.jpg')
        response = MagicMock()
        response.__enter__.return_value = response
        response.status_code = 200
        megabyte = b'x' * (1024 * 1024)
        response.iter_content.return_value = (megabyte for _ in range(MAX_IMAGE_BYTES // len(megabyte) + 1))

        with patch('classification.images.requests.get', return_value=response):
            download_image(post_image)

        self.assertEqual(post_image.status, IMAGE_FAILED)
        self.assertFalse(post_image.file)
