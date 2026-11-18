from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


PLATFORM_REDDIT = 'reddit'
PLATFORM_X = 'x'
PLATFORM_YOUTUBE = 'youtube'
PLATFORM_CHOICES = [
    (PLATFORM_REDDIT, 'Reddit'),
    (PLATFORM_X, 'X'),
    (PLATFORM_YOUTUBE, 'YouTube'),
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

TRANSCRIPT_PENDING = 'pending'
TRANSCRIPT_FETCHED = 'fetched'
TRANSCRIPT_MISSING = 'missing'
TRANSCRIPT_STATUS_CHOICES = [
    (TRANSCRIPT_PENDING, 'Pending'),
    (TRANSCRIPT_FETCHED, 'Fetched'),
    (TRANSCRIPT_MISSING, 'Missing'),
]

# Who supplied a transcript: a reader's browser, or the worker's own download.
TRANSCRIPT_SOURCE_BROWSER = 'browser'
TRANSCRIPT_SOURCE_SERVER = 'server'
TRANSCRIPT_SOURCE_CHOICES = [
    (TRANSCRIPT_SOURCE_BROWSER, 'Browser'),
    (TRANSCRIPT_SOURCE_SERVER, 'Server'),
]

VIDEO_PENDING = 'pending'
VIDEO_READY = 'ready'
VIDEO_MISSING = 'missing'
VIDEO_STATUS_CHOICES = [
    (VIDEO_PENDING, 'Pending'),
    (VIDEO_READY, 'Ready'),
    (VIDEO_MISSING, 'Missing'),
]

CLASSIFICATION_PENDING = 'pending'
CLASSIFICATION_DONE = 'done'
CLASSIFICATION_FAILED = 'failed'
# A video filter meeting a post that has no video. Finished, and never flags.
CLASSIFICATION_NOT_APPLICABLE = 'not_applicable'
CLASSIFICATION_STATUS_CHOICES = [
    (CLASSIFICATION_PENDING, 'Pending'),
    (CLASSIFICATION_DONE, 'Done'),
    (CLASSIFICATION_FAILED, 'Failed'),
    (CLASSIFICATION_NOT_APPLICABLE, 'Not applicable'),
]

# What a plugin judges: a post as text and images, or the video in it, watched and listened to.
PLUGIN_INPUT_POST = 'post'
PLUGIN_INPUT_VIDEO = 'video'
PLUGIN_INPUT_CHOICES = [
    (PLUGIN_INPUT_POST, 'Post'),
    (PLUGIN_INPUT_VIDEO, 'Video'),
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


class VideoTranscript(models.Model):
    """The transcript of a YouTube video, settled once, before the video is
    classified: sent by the first reader's browser that reports on it, or
    downloaded by the worker when YOUTUBE_SERVER_TRANSCRIPTS is on. A video
    whose transcript cannot be had is classified on its title and thumbnail,
    and missing_reason says why."""

    post = models.OneToOneField(Post, on_delete=models.CASCADE, related_name='transcript')
    status = models.CharField(max_length=16, choices=TRANSCRIPT_STATUS_CHOICES, default=TRANSCRIPT_PENDING)
    # Blank while pending.
    source = models.CharField(max_length=16, choices=TRANSCRIPT_SOURCE_CHOICES, blank=True, default='')
    language_code = models.CharField(max_length=16, blank=True, default='')
    is_generated = models.BooleanField(null=True, blank=True)
    # The transcript as YouTube gives it: [{"text", "start", "duration"}], times in seconds.
    # A browser sends plain text, which is stored as a single {"text"} snippet.
    snippets = models.JSONField(default=list, blank=True)
    missing_reason = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    fetched_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['id'], condition=models.Q(status=TRANSCRIPT_PENDING), name='pending_transcripts'),
        ]

    def text(self):
        return ' '.join(snippet['text'] for snippet in self.snippets)

    def __str__(self):
        return f"transcript of {self.post} ({self.status})"


class PostVideo(models.Model):
    """The video in a post, as a video filter watches it. Settled once for
    every reader. A Reddit or X video is downloaded once, cut to its opening
    seconds, and the clip is kept, so judging it again never asks the site
    again. A YouTube video is never downloaded: the model provider fetches it
    by its URL, whole."""

    post = models.OneToOneField(Post, on_delete=models.CASCADE, related_name='video')
    status = models.CharField(max_length=16, choices=VIDEO_STATUS_CHOICES, default=VIDEO_PENDING)
    # Where the reader's page plays the video: a Reddit HLS playlist, an X post, a YouTube watch page.
    source_url = models.TextField()
    # The video's full length, when the page or the site says it.
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    # The opening of a Reddit or X video, at most VIDEO_WATCH_SECONDS long. Empty for YouTube.
    clip = models.FileField(upload_to='post_videos/%Y/%m/', blank=True)
    clip_seconds = models.FloatField(null=True, blank=True)
    clip_bytes = models.PositiveIntegerField(null=True, blank=True)
    missing_reason = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    settled_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['id'], condition=models.Q(status=VIDEO_PENDING), name='pending_post_videos'),
        ]

    def __str__(self):
        return f"video of {self.post} ({self.status})"


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
    # Suggested on the family page when an admin edits a child's plugins.
    suggested_for_children = models.BooleanField(default=False)
    # The threshold a user starts with when the plugin is installed.
    default_threshold = models.PositiveSmallIntegerField(
        default=60,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    input_kind = models.CharField(max_length=16, choices=PLUGIN_INPUT_CHOICES, default=PLUGIN_INPUT_POST)
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
    # [{name, question, points}]. With criteria, the model answers only whether
    # the post meets each one, and the score is the sum of the points of those
    # met (classification.scoring). Empty: the model gives the score itself.
    criteria = models.JSONField(default=list, blank=True)
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
    # The names of the criteria the post met, for a plugin version with criteria.
    criteria_met = models.JSONField(default=list, blank=True)
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
    # The last time the extension sent posts with this token, which first
    # happens when the reader opens Reddit or X after connecting.
    last_classify_request_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"extension token {self.id} for {self.user}"


class PostSubmission(models.Model):
    """Which account sent which post, and when: one row per account and post,
    updated every time the account sends the post again. Kept for analysis and
    to trace abuse back to an account; deleted with the account."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='post_submissions')
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='submissions')
    # The extension connection that last sent it; kept when that connection is removed.
    extension_token = models.ForeignKey(ExtensionToken, on_delete=models.SET_NULL, null=True, blank=True)
    first_seen_at = models.DateTimeField()
    last_seen_at = models.DateTimeField()
    times_seen = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'post'], name='unique_submission_per_user_and_post'),
        ]
        indexes = [
            models.Index(fields=['user', 'last_seen_at'], name='submissions_by_user_and_time'),
        ]

    def __str__(self):
        return f"{self.post} sent by {self.user}"


VERDICT_RIGHT = 'right'
VERDICT_WRONG = 'wrong'
VERDICT_CHOICES = [
    (VERDICT_RIGHT, 'Right (thumbs up)'),
    (VERDICT_WRONG, 'Wrong (thumbs down)'),
]

SEVERITY_LOW = 'low'
SEVERITY_MEDIUM = 'medium'
SEVERITY_HIGH = 'high'
SEVERITY_CHOICES = [
    (SEVERITY_LOW, 'Low'),
    (SEVERITY_MEDIUM, 'Medium'),
    (SEVERITY_HIGH, 'High'),
]

SHOWN_ACTION_CHOICES = [
    (ACTION_ALLOW, 'Shown'),
    (ACTION_BLUR, 'Blurred'),
    (ACTION_HIDE, 'Hidden'),
]


class PostJudgment(models.Model):
    """A reader's verdict on how the extension treated one post: a labeled
    example of the reader's real judgment, for evaluating and tuning filters.
    A thumbs down on a post that was shown means a filter should have caught
    it. One per account and post; judging the post again replaces it."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='post_judgments')
    post = models.ForeignKey(Post, on_delete=models.CASCADE, related_name='judgments')
    verdict = models.CharField(max_length=16, choices=VERDICT_CHOICES)
    # What the reader saw. A hidden post on screen is blurred instead, so this
    # can be blur where the filters decided hide; filter_results has the decision.
    shown_action = models.CharField(max_length=16, choices=SHOWN_ACTION_CHOICES)
    # The filter the verdict is about: the strongest one that flagged the post,
    # or, for a shown post that should have been caught, the one the reader
    # names. Empty when the reader names none.
    plugin = models.ForeignKey(Plugin, on_delete=models.PROTECT, null=True, blank=True, related_name='judgments')
    # How much the verdict matters to the reader. Blank until the reader says.
    severity = models.CharField(max_length=16, choices=SEVERITY_CHOICES, blank=True, default='')
    details = models.TextField(blank=True, default='')
    # What every filter the reader had on decided about the post when it was
    # judged: [{plugin, version, classification_id, status, score, label,
    # threshold, flagged_action, flagged}].
    filter_results = models.JSONField(default=list, blank=True)
    extension_commit = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'post'], name='unique_judgment_per_user_and_post'),
        ]

    def __str__(self):
        return f"{self.verdict} on {self.post} by {self.user}"
