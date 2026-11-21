"""The /tuning page's API, open only to the owner, as the inbox is: pick a
filter, run a draft of its rubric as an experiment, read past experiments,
and clean up the owner's thumbs. Nothing here changes live filtering."""

from django.conf import settings
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.response import Response

from classification.inference import configured_model
from classification.models import VERDICT_CHOICES, Plugin
from feedback.views import CanOpenInbox

from .models import CASE_SYNTHETIC, CASE_THUMB, TuningExperiment
from .runs import decides_to_flag, owner_judgments, owner_judgments_for, synthetic_examples_for

# Names the model's answer already uses, or the label of a post that meets no criterion.
RESERVED_CRITERION_NAMES = {'reasoning', 'none'}


def tunable_plugins():
    """The filters scored by criteria: every rubric the page can edit."""
    tunable = []
    for plugin in Plugin.objects.filter(is_baseline=True).order_by('name'):
        live_version = plugin.latest_version()
        if live_version is not None and live_version.criteria:
            tunable.append(plugin)
    return tunable


def live_rubric(plugin):
    live_version = plugin.latest_version()
    return {
        'version': live_version.version,
        'rubric_prompt': live_version.rubric_prompt,
        'criteria': live_version.criteria,
        'threshold': plugin.default_threshold,
    }


def answer_counts(results, answer_field, threshold_of):
    counts = {'right': 0, 'missed': 0, 'wrongly_flagged': 0, 'failed': 0}
    for result in results:
        answer = getattr(result, answer_field)
        if answer['failed']:
            counts['failed'] += 1
            continue
        flagged = decides_to_flag(answer, threshold_of(result))
        if flagged == result.should_flag:
            counts['right'] += 1
        elif result.should_flag:
            counts['missed'] += 1
        else:
            counts['wrongly_flagged'] += 1
    return counts


def experiment_summary(experiment):
    results = list(experiment.results.all())
    scores = {}
    for source in [CASE_THUMB, CASE_SYNTHETIC]:
        source_results = [result for result in results if result.source == source]
        if not source_results:
            continue
        scores[source] = {
            'cases': len(source_results),
            'draft': answer_counts(source_results, 'draft', lambda result: experiment.threshold),
            'live': answer_counts(source_results, 'live', lambda result: experiment.live_threshold),
        }
    costs = [result.cost for result in results if result.cost is not None]
    return {
        'id': experiment.id,
        'plugin': experiment.plugin.slug,
        'created_at': experiment.created_at.isoformat(),
        'finished_at': experiment.finished_at.isoformat() if experiment.finished_at else None,
        'status': experiment.status,
        'error': experiment.error,
        'live_version': experiment.live_version.version,
        'live_threshold': experiment.live_threshold,
        'started_from': experiment.started_from_id,
        'threshold': experiment.threshold,
        'include_synthetic': experiment.include_synthetic,
        'explain_every_case': experiment.explain_every_case,
        'model': experiment.model,
        'inference_source': experiment.inference_source,
        'total_cases': experiment.total_cases,
        'judged_cases': len(results),
        'scores': scores,
        'prompt_tokens': sum(result.prompt_tokens for result in results),
        'completion_tokens': sum(result.completion_tokens for result in results),
        'cost': sum(costs) if costs else None,
    }


def result_as_dict(result):
    return {
        'case_id': result.case_id,
        'source': result.source,
        'judgment_id': result.judgment_id,
        'post': result.post,
        'image_urls': result.image_urls,
        'post_url': result.post_url,
        'should_flag': result.should_flag,
        'owner': result.owner,
        'video_not_watched': result.video_not_watched,
        'draft': result.draft,
        'live': result.live,
        'live_reused': result.live_reused,
        'explanations': result.explanations,
    }


def experiment_as_dict(experiment):
    experiment_dict = experiment_summary(experiment)
    experiment_dict['rubric_prompt'] = experiment.rubric_prompt
    experiment_dict['criteria'] = experiment.criteria
    experiment_dict['results'] = [result_as_dict(result) for result in experiment.results.order_by('id')]
    return experiment_dict


class CriterionSerializer(serializers.Serializer):
    # The name is a field of the model's JSON answer.
    name = serializers.RegexField(r'^[a-z][a-z0-9_]*$', max_length=60,
                                  error_messages={'invalid': 'A criterion name is lowercase letters, digits and underscores.'})
    question = serializers.CharField()
    points = serializers.IntegerField(min_value=-100, max_value=100)


class DraftSerializer(serializers.Serializer):
    plugin = serializers.SlugField()
    rubric_prompt = serializers.CharField()
    criteria = CriterionSerializer(many=True, allow_empty=False)
    threshold = serializers.IntegerField(min_value=0, max_value=100)
    include_synthetic = serializers.BooleanField(default=False)
    explain_every_case = serializers.BooleanField(default=False)
    started_from = serializers.IntegerField(required=False, allow_null=True)

    def validate_criteria(self, criteria):
        names = [criterion['name'] for criterion in criteria]
        if len(set(names)) != len(names):
            raise serializers.ValidationError('Two criteria have the same name.')
        reserved = RESERVED_CRITERION_NAMES.intersection(names)
        if reserved:
            raise serializers.ValidationError(f"A criterion cannot be named {', '.join(sorted(reserved))}.")
        return criteria


def owner_only(view):
    view = throttle_classes([])(view)
    view = permission_classes([CanOpenInbox])(view)
    return authentication_classes([SessionAuthentication])(view)


@api_view(['GET'])
@owner_only
def list_filters(request):
    filters = []
    for plugin in tunable_plugins():
        filters.append({
            'slug': plugin.slug,
            'name': plugin.name,
            'input_kind': plugin.input_kind,
            'live': live_rubric(plugin),
            'thumb_cases': len(owner_judgments_for(plugin)),
            'synthetic_cases': len(synthetic_examples_for(plugin)),
        })
    return Response({'filters': filters, 'model': configured_model(), 'inference_source': settings.INFERENCE_SOURCE})


@api_view(['GET', 'POST'])
@owner_only
def experiments(request):
    if request.method == 'GET':
        found = TuningExperiment.objects.select_related('plugin', 'live_version').prefetch_related('results').order_by('-id')
        plugin_slug = request.query_params.get('plugin')
        if plugin_slug:
            found = found.filter(plugin__slug=plugin_slug)
        return Response({'experiments': [experiment_summary(experiment) for experiment in found]})

    serializer = DraftSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    draft = serializer.validated_data
    plugin = next((plugin for plugin in tunable_plugins() if plugin.slug == draft['plugin']), None)
    if plugin is None:
        return Response({'error': f"No filter {draft['plugin']} to tune."}, status=status.HTTP_400_BAD_REQUEST)
    if draft['include_synthetic'] and not synthetic_examples_for(plugin):
        return Response({'error': f"The synthetic test set has no examples for {plugin.slug}."},
                        status=status.HTTP_400_BAD_REQUEST)
    started_from = None
    if draft.get('started_from') is not None:
        started_from = TuningExperiment.objects.filter(id=draft['started_from']).first()

    experiment = TuningExperiment.objects.create(
        plugin=plugin,
        live_version=plugin.latest_version(),
        live_threshold=plugin.default_threshold,
        started_from=started_from,
        rubric_prompt=draft['rubric_prompt'],
        criteria=[dict(criterion) for criterion in draft['criteria']],
        threshold=draft['threshold'],
        include_synthetic=draft['include_synthetic'],
        explain_every_case=draft['explain_every_case'],
        model=configured_model(),
        inference_source=settings.INFERENCE_SOURCE,
    )
    return Response(experiment_as_dict(experiment), status=status.HTTP_201_CREATED)


@api_view(['GET'])
@owner_only
def experiment_detail(request, experiment_id):
    experiment = TuningExperiment.objects.select_related('plugin', 'live_version').filter(id=experiment_id).first()
    if experiment is None:
        return Response({'error': f"No experiment {experiment_id}."}, status=status.HTTP_404_NOT_FOUND)
    return Response(experiment_as_dict(experiment))


class ThumbChangeSerializer(serializers.Serializer):
    verdict = serializers.ChoiceField(choices=VERDICT_CHOICES, required=False)
    details = serializers.CharField(required=False, allow_blank=True)


def thumb_as_dict(judgment):
    return {'id': judgment.id, 'verdict': judgment.verdict, 'details': judgment.details}


@api_view(['PATCH', 'DELETE'])
@owner_only
def thumb_detail(request, judgment_id):
    """Changes the verdict or note of one of the owner's thumbs, or deletes it."""
    judgment = owner_judgments().filter(id=judgment_id).first()
    if judgment is None:
        return Response({'error': f"No thumbs {judgment_id} of yours."}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'DELETE':
        judgment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = ThumbChangeSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    for field_name, value in serializer.validated_data.items():
        setattr(judgment, field_name, value)
    judgment.save()
    return Response(thumb_as_dict(judgment))
