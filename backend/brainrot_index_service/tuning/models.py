"""The owner's experiments with a filter's rubric, from the /tuning page.

An experiment is a draft of a filter's rubric (its text, criteria and cutoff)
judged on the owner's thumbs, and optionally on the synthetic test set, beside
the live version. Nothing here changes live filtering: a draft goes live only
when an engineer releases it as a new PluginVersion."""

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from classification.models import Plugin, PluginVersion, PostJudgment
from classification.scoring import LABEL_NO_CRITERION_MET

EXPERIMENT_PENDING = 'pending'
EXPERIMENT_RUNNING = 'running'
EXPERIMENT_DONE = 'done'
EXPERIMENT_FAILED = 'failed'
EXPERIMENT_STATUS_CHOICES = [
    (EXPERIMENT_PENDING, 'Pending'),
    (EXPERIMENT_RUNNING, 'Running'),
    (EXPERIMENT_DONE, 'Done'),
    (EXPERIMENT_FAILED, 'Failed'),
]

CASE_THUMB = 'thumb'
CASE_SYNTHETIC = 'synthetic'
CASE_SOURCE_CHOICES = [
    (CASE_THUMB, "The owner's thumbs"),
    (CASE_SYNTHETIC, 'Synthetic test set'),
]


def allowed_labels(criteria):
    """The label is the met criterion that adds the most points, or none."""
    return [LABEL_NO_CRITERION_MET] + [criterion['name'] for criterion in criteria if criterion['points'] > 0]


class TuningExperiment(models.Model):
    """One run of a draft rubric. Its model and inference source are those
    production used when it ran, so its answers are what production would give."""

    plugin = models.ForeignKey(Plugin, on_delete=models.PROTECT, related_name='tuning_experiments')
    # The live version and cutoff when the experiment was made, judged beside the draft.
    live_version = models.ForeignKey(PluginVersion, on_delete=models.PROTECT, related_name='tuning_experiments')
    live_threshold = models.PositiveSmallIntegerField()
    # The experiment the draft was edited from; empty when it started from the live version.
    started_from = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True)
    rubric_prompt = models.TextField()
    # [{name, question, points}], as PluginVersion.criteria.
    criteria = models.JSONField()
    # A post scoring at or above the cutoff is flagged.
    threshold = models.PositiveSmallIntegerField(validators=[MinValueValidator(0), MaxValueValidator(100)])
    include_synthetic = models.BooleanField(default=False)
    # Without it, only the posts the draft gets wrong or decides differently from the live version are explained.
    explain_every_case = models.BooleanField(default=False)
    model = models.CharField(max_length=200)
    inference_source = models.CharField(max_length=32)
    status = models.CharField(max_length=16, choices=EXPERIMENT_STATUS_CHOICES, default=EXPERIMENT_PENDING)
    error = models.TextField(blank=True, default='')
    # Known once the run starts.
    total_cases = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # The last progress of a run, so a run whose worker died is taken up again.
    heartbeat_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    def draft_version(self):
        """The draft as an unsaved plugin version, the form the production prompt code takes."""
        return PluginVersion(
            plugin=self.plugin,
            version=0,
            rubric_prompt=self.rubric_prompt,
            criteria=self.criteria,
            allowed_labels=allowed_labels(self.criteria),
        )

    def __str__(self):
        return f"experiment {self.id} on {self.plugin.slug}"


class TuningResult(models.Model):
    """The draft's and the live version's answers on one post. What the post
    showed and what the owner said are copied in, so the experiment reads the
    same after a thumbs is changed or deleted."""

    experiment = models.ForeignKey(TuningExperiment, on_delete=models.CASCADE, related_name='results')
    # "judgment-12" for a thumbs, the example's id for the synthetic test set.
    case_id = models.CharField(max_length=64)
    source = models.CharField(max_length=16, choices=CASE_SOURCE_CHOICES)
    # The thumbs, while it exists.
    judgment = models.ForeignKey(PostJudgment, on_delete=models.SET_NULL, null=True, blank=True, related_name='tuning_results')
    # The post as the model read it, context included.
    description = models.TextField()
    # The post as a reader sees it, for the page, as runs.post_as_read gives it.
    post = models.JSONField(default=dict)
    # Where the post's images are on the web. Empty for the synthetic test set.
    image_urls = models.JSONField(default=list, blank=True)
    post_url = models.TextField(blank=True, default='')
    should_flag = models.BooleanField()
    # A thumbs: {verdict, shown_action, should_be, plugin, details}, plugin being the filter
    # it is blocked as, or empty. A synthetic example: {why}.
    owner = models.JSONField(default=dict)
    # True for a filter that watches videos, on a post whose video production watched;
    # the draft judges it on its text and images only.
    video_not_watched = models.BooleanField(default=False)
    # Each answer: {failed, score, criteria_met, reasoning}.
    draft = models.JSONField()
    live = models.JSONField()
    # The live answer was taken from an earlier experiment with the same live version and model.
    live_reused = models.BooleanField(default=False)
    # Why the draft's answer judged each criterion met or not: {criterion name: explanation}.
    explanations = models.JSONField(default=dict, blank=True)
    # Every model call made for this post in this experiment.
    prompt_tokens = models.PositiveIntegerField(default=0)
    completion_tokens = models.PositiveIntegerField(default=0)
    # As the provider reported it; None when it reported none.
    cost = models.FloatField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['experiment', 'case_id'], name='unique_tuning_case_per_experiment'),
        ]

    def __str__(self):
        return f"{self.case_id} in {self.experiment}"
