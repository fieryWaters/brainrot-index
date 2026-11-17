from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


PLATFORM_REDDIT = 'reddit'
PLATFORM_X = 'x'
PLATFORM_CHOICES = [
    (PLATFORM_REDDIT, 'Reddit'),
    (PLATFORM_X, 'X'),
]

POST_KIND_POST = 'post'
POST_KIND_REPLY = 'reply'
POST_KIND_CHOICES = [
    (POST_KIND_POST, 'Post'),
    (POST_KIND_REPLY, 'Reply'),
]

IMAGE_PENDING = 'pending'
IMAGE_DOWNLOADED = 'downloaded'
IMAGE_FAILED = 'failed'
IMAGE_REJECTED = 'rejected'
IMAGE_STATUS_CHOICES = [
    (IMAGE_PENDING, 'Pending'),
    (IMAGE_DOWNLOADED, 'Downloaded'),
    (IMAGE_FAILED, 'Failed'),
    (IMAGE_REJECTED, 'Rejected (host not allowed)'),
]

CLASSIFICATION_PENDING = 'pending'
CLASSIFICATION_DONE = 'done'
CLASSIFICATION_FAILED = 'failed'
CLASSIFICATION_STATUS_CHOICES = [
    (CLASSIFICATION_PENDING, 'Pending'),
    (CLASSIFICATION_DONE, 'Done'),
    (CLASSIFICATION_FAILED, 'Failed'),
]

ACTION_ALLOW = 'allow'
ACTION_BLUR = 'blur'
ACTION_HIDE = 'hide'
FLAGGED_ACTION_CHOICES = [
    (ACTION_BLUR, 'Blur'),
    (ACTION_HIDE, 'Hide'),
]

MODE_ADULT = 'adult'
MODE_CHILD = 'child'
MODE_CHOICES = [
    (MODE_ADULT, 'Adult'),
    (MODE_CHILD, 'Child'),
]


class Post(models.Model):
    """A post or reply as it was first seen. Seeing it again never overwrites it."""

    platform = models.CharField(max_length=16, choices=PLATFORM_CHOICES)
    post_id = models.CharField(max_length=128)
    kind = models.CharField(max_length=16, choices=POST_KIND_CHOICES)
    parent_post_id = models.CharField(max_length=128, blank=True, default='')
    url = models.TextField(blank=True, default='')
    author = models.CharField(max_length=255, blank=True, default='')
    community = models.CharField(max_length=255, blank=True, default='')
    text = models.TextField(blank=True, default='')
    image_urls = models.JSONField(default=list, blank=True)
    first_seen_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['platform', 'post_id'], name='unique_post_per_platform'),
        ]

    def __str__(self):
        return f"{self.platform}:{self.post_id}"


class PostImage(models.Model):
    """One image of a post, with its original bytes kept on disk."""

    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='images')
    source_url = models.TextField()
    file = models.FileField(upload_to='post_images/%Y/%m/', blank=True)
    byte_size = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=IMAGE_STATUS_CHOICES, default=IMAGE_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['id'], condition=models.Q(status=IMAGE_PENDING), name='pending_post_images'),
        ]

    def __str__(self):
        return f"image {self.id} of {self.post} ({self.status})"


class Plugin(models.Model):
    """A kind of unwanted content, such as engagement bait. Its rubric lives in its versions."""

    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=300)
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='authored_plugins',
    )
    # The name shown as the plugin's author in the store, chosen when it is published.
    author_name = models.CharField(max_length=60, blank=True, default='')
    is_baseline = models.BooleanField(default=False)
    # An unlisted plugin is hidden from the store and cannot be installed;
    # accounts that already installed it keep it.
    is_listed = models.BooleanField(default=True)
    # The threshold a user starts with when the plugin is installed.
    default_threshold = models.PositiveSmallIntegerField(
        default=60,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def latest_version(self):
        return self.versions.order_by('-version').first()

    def __str__(self):
        return self.name


class PluginVersion(models.Model):
    """An immutable rubric. Changing a rubric means a new version, so cached
    classifications always describe exactly the prompt that produced them."""

    plugin = models.ForeignKey(Plugin, on_delete=models.PROTECT, related_name='versions')
    version = models.PositiveIntegerField()
    # The full system prompt before the response instructions. For a plugin
    # published in the store it is author_rubric inside the fixed frame.
    rubric_prompt = models.TextField()
    # The rubric as a store author wrote it. Blank for the baseline plugins.
    author_rubric = models.TextField(blank=True, default='')
    allowed_labels = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['plugin', 'version'], name='unique_plugin_version'),
        ]

    def save(self, *args, **kwargs):
        if self.pk is not None:
            raise ValueError('A plugin version is immutable; publish a new version instead.')
        super().save(*args, **kwargs)

    def displayed_rubric(self):
        if self.author_rubric:
            return self.author_rubric
        return self.rubric_prompt

    def __str__(self):
        return f"{self.plugin.name} v{self.version}"


class Classification(models.Model):
    """The result of applying one plugin version to one post: the shared cache,
    so each post costs one model call per plugin version across all users."""

    post = models.ForeignKey(Post, on_delete=models.PROTECT, related_name='classifications')
    plugin_version = models.ForeignKey(PluginVersion, on_delete=models.PROTECT, related_name='classifications')
    status = models.CharField(
        max_length=16,
        choices=CLASSIFICATION_STATUS_CHOICES,
        default=CLASSIFICATION_PENDING,
    )
    score = models.PositiveSmallIntegerField(null=True, blank=True)
    label = models.CharField(max_length=64, blank=True, default='')
    reasoning = models.TextField(blank=True, default='')
    # The chat messages sent, with each image replaced by "post_image:<PostImage id>".
    prompt = models.JSONField(null=True, blank=True)
    raw_response = models.TextField(blank=True, default='')
    model = models.CharField(max_length=200, blank=True, default='')
    inference_source = models.CharField(max_length=32, blank=True, default='')
    prompt_tokens = models.PositiveIntegerField(null=True, blank=True)
    completion_tokens = models.PositiveIntegerField(null=True, blank=True)
    latency_ms = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['post', 'plugin_version'], name='unique_classification'),
        ]
        indexes = [
            models.Index(
                fields=['id'],
                condition=models.Q(status=CLASSIFICATION_PENDING),
                name='pending_classifications',
            ),
        ]

    def __str__(self):
        return f"{self.plugin_version} on {self.post} ({self.status})"


class UserPlugin(models.Model):
    """A plugin a user has installed, and how strictly it applies to them."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='installed_plugins')
    plugin = models.ForeignKey(Plugin, on_delete=models.PROTECT, related_name='installations')
    enabled = models.BooleanField(default=True)
    # A post scoring at or above the threshold is flagged.
    threshold = models.PositiveSmallIntegerField(
        default=60,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    flagged_action = models.CharField(max_length=16, choices=FLAGGED_ACTION_CHOICES, default=ACTION_HIDE)
    installed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'plugin'], name='unique_installed_plugin'),
        ]

    def __str__(self):
        return f"{self.plugin} for {self.user}"


class UserSettings(models.Model):
    """The user's filtering switches."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='filter_settings')
    enabled = models.BooleanField(default=True)
    mode = models.CharField(max_length=16, choices=MODE_CHOICES, default=MODE_ADULT)
    allow_reveal = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = 'user settings'

    def __str__(self):
        return f"settings for {self.user}"


class ExtensionToken(models.Model):
    """A browser extension's credential. Stores only the SHA-256 hash."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='extension_tokens')
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"extension token {self.id} for {self.user}"
