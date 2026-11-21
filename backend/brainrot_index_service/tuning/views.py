"""The /tuning page's API, open only to the owner, as the inbox is: pick a
filter, run a draft of its rubric as an experiment, or a draft of a feature
set for every filter at once, read past experiments, and clean up the
owner's thumbs. Nothing here changes live filtering."""

from django.conf import settings
from rest_framework import serializers, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.response import Response

from classification.evaluation import owner_judgments
from classification.features import FORM_PRODUCT, FORM_WEIGHTED_SUM, FORMS, features_prompt, features_used, filter_score
from classification.inference import configured_model
from classification.models import SHOULD_BE_CHOICES, SHOULD_BE_SHOWN, FeatureSet, Plugin
from feedback.views import CanOpenInbox

from .feature_runs import create_experiment, filter_counts
from .models import FeatureExperiment, TuningExperiment
from .runs import decides_to_flag, owner_judgments_for

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
    scores = None
    if results:
        scores = {
            'cases': len(results),
            'draft': answer_counts(results, 'draft', lambda result: experiment.threshold),
            'live': answer_counts(results, 'live', lambda result: experiment.live_threshold),
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
    should_be = serializers.ChoiceField(choices=SHOULD_BE_CHOICES, required=False)
    # The filter a post that should be blocked is blocked as; null for Other.
    plugin = serializers.SlugRelatedField(slug_field='slug', queryset=Plugin.objects.all(), allow_null=True, required=False)
    details = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs.get('should_be') == SHOULD_BE_SHOWN:
            attrs['plugin'] = None
        return attrs


def thumb_as_dict(judgment):
    plugin_slug = judgment.plugin.slug if judgment.plugin is not None else ''
    return {'id': judgment.id, 'should_be': judgment.should_be, 'plugin': plugin_slug, 'details': judgment.details}


@api_view(['PATCH', 'DELETE'])
@owner_only
def thumb_detail(request, judgment_id):
    """Changes the label or note of one of the owner's thumbs, or deletes it."""
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


# -- Feature set experiments --

class FeatureLevelSerializer(serializers.Serializer):
    text = serializers.CharField()
    # One or two short invented examples, never posts from the owner's thumbs, which are the test set.
    examples = serializers.ListField(child=serializers.CharField(), max_length=2, default=list)


class FeatureSerializer(serializers.Serializer):
    # The name is a field of the model's JSON answer.
    name = serializers.RegexField(r'^[a-z][a-z0-9_]*$', max_length=60,
                                  error_messages={'invalid': 'A feature name is lowercase letters, digits and underscores.'})
    description = serializers.CharField()
    levels = FeatureLevelSerializer(many=True, min_length=2)


class FeatureFilterSerializer(serializers.Serializer):
    plugin = serializers.SlugField()
    form = serializers.ChoiceField(choices=FORMS)
    # For a product.
    features = serializers.ListField(child=serializers.CharField(), required=False)
    # For a weighted sum: {feature name: multiplier}.
    weights = serializers.DictField(child=serializers.FloatField(), required=False)
    cutoff = serializers.IntegerField(min_value=0, max_value=100)

    def validate(self, attrs):
        if attrs['form'] == FORM_PRODUCT:
            if not attrs.get('features'):
                raise serializers.ValidationError(f"{attrs['plugin']}: a product needs at least one feature.")
            return {'plugin': attrs['plugin'], 'form': FORM_PRODUCT, 'features': attrs['features'], 'cutoff': attrs['cutoff']}
        if not attrs.get('weights'):
            raise serializers.ValidationError(f"{attrs['plugin']}: a weighted sum needs at least one feature.")
        return {'plugin': attrs['plugin'], 'form': FORM_WEIGHTED_SUM, 'weights': attrs['weights'], 'cutoff': attrs['cutoff']}


class FeatureDraftSerializer(serializers.Serializer):
    features = FeatureSerializer(many=True, allow_empty=False)
    filters = FeatureFilterSerializer(many=True, allow_empty=False)
    explain_every_case = serializers.BooleanField(default=False)
    started_from = serializers.IntegerField(required=False, allow_null=True)
    started_from_feature_set = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        names = [feature['name'] for feature in attrs['features']]
        if len(set(names)) != len(names):
            raise serializers.ValidationError('Two features have the same name.')
        tunable_slugs = {plugin.slug for plugin in tunable_plugins()}
        plugin_slugs = [filter_definition['plugin'] for filter_definition in attrs['filters']]
        if len(set(plugin_slugs)) != len(plugin_slugs):
            raise serializers.ValidationError('Two filters replace the same live filter.')
        for filter_definition in attrs['filters']:
            if filter_definition['plugin'] not in tunable_slugs:
                raise serializers.ValidationError(f"No live filter {filter_definition['plugin']} to compare with.")
            unknown = set(features_used(filter_definition)) - set(names)
            if unknown:
                raise serializers.ValidationError(
                    f"{filter_definition['plugin']} uses features that are not defined: {', '.join(sorted(unknown))}.")
        return attrs


def feature_set_as_dict(feature_set):
    return {'id': feature_set.id, 'version': feature_set.version,
            'features': feature_set.features, 'filters': feature_set.filters}


def feature_experiment_summary(experiment, results=None):
    if results is None:
        results = list(experiment.results.all())
    scores = {}
    for filter_definition in experiment.filters:
        slug = filter_definition['plugin']
        counts = filter_counts(filter_definition, experiment.live[slug], results)
        if counts['cases'] > 0:
            scores[slug] = counts
    costs = [result.cost for result in results if result.cost is not None]
    return {
        'id': experiment.id,
        'created_at': experiment.created_at.isoformat(),
        'finished_at': experiment.finished_at.isoformat() if experiment.finished_at else None,
        'status': experiment.status,
        'error': experiment.error,
        'started_from': experiment.started_from_id,
        'started_from_feature_set': (experiment.started_from_feature_set.version
                                     if experiment.started_from_feature_set else None),
        'filters': experiment.filters,
        'live': experiment.live,
        'explain_every_case': experiment.explain_every_case,
        'model': experiment.model,
        'inference_source': experiment.inference_source,
        'total_cases': experiment.total_cases,
        'judged_cases': len(results),
        'scores': scores,
        'prompt_tokens': sum(result.prompt_tokens for result in results),
        'cached_prompt_tokens': sum(result.cached_prompt_tokens for result in results),
        'completion_tokens': sum(result.completion_tokens for result in results),
        'cost': sum(costs) if costs else None,
    }


def feature_result_as_dict(result, filters):
    filter_scores = {}
    for filter_definition in filters:
        slug = filter_definition['plugin']
        if slug in result.expected:
            filter_scores[slug] = None if result.failed else filter_score(filter_definition, result.scores)
    return {
        'case_id': result.case_id,
        'judgment_id': result.judgment_id,
        'post': result.post,
        'image_urls': result.image_urls,
        'post_url': result.post_url,
        'expected': result.expected,
        'owner': result.owner,
        'video_not_watched': result.video_not_watched,
        'scores': result.scores,
        'failed': result.failed,
        'reasons': result.reasons,
        'live': result.live,
        'filter_scores': filter_scores,
    }


def feature_experiment_as_dict(experiment):
    results = list(experiment.results.order_by('id'))
    experiment_dict = feature_experiment_summary(experiment, results)
    experiment_dict['features'] = experiment.features
    experiment_dict['system_prompt'] = features_prompt(experiment.features)
    experiment_dict['results'] = [feature_result_as_dict(result, experiment.filters) for result in results]
    return experiment_dict


@api_view(['GET'])
@owner_only
def feature_overview(request):
    """The saved feature set to start a draft from, the live filters a draft
    can replace with their test set sizes, and the past experiments."""
    filters = []
    for plugin in tunable_plugins():
        live_version = plugin.latest_version()
        filters.append({
            'slug': plugin.slug,
            'name': plugin.name,
            'input_kind': plugin.input_kind,
            'live': {'version': live_version.version, 'threshold': plugin.default_threshold},
            'thumb_cases': len(owner_judgments_for(plugin)),
        })
    feature_set = FeatureSet.objects.order_by('-version').first()
    experiments_found = (FeatureExperiment.objects.select_related('started_from_feature_set')
                         .prefetch_related('results').order_by('-id'))
    return Response({
        'feature_set': feature_set_as_dict(feature_set) if feature_set else None,
        'filters': filters,
        'model': configured_model(),
        'inference_source': settings.INFERENCE_SOURCE,
        'experiments': [feature_experiment_summary(experiment) for experiment in experiments_found],
    })


@api_view(['POST'])
@owner_only
def feature_experiments(request):
    serializer = FeatureDraftSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    draft = serializer.validated_data
    started_from = None
    if draft.get('started_from') is not None:
        started_from = FeatureExperiment.objects.filter(id=draft['started_from']).first()
    started_from_feature_set = None
    if draft.get('started_from_feature_set') is not None:
        started_from_feature_set = FeatureSet.objects.filter(id=draft['started_from_feature_set']).first()
    experiment = create_experiment(
        features=[as_plain_data(feature) for feature in draft['features']],
        filters=[as_plain_data(filter_definition) for filter_definition in draft['filters']],
        explain_every_case=draft['explain_every_case'],
        started_from_feature_set=started_from_feature_set,
        started_from=started_from,
    )
    return Response(feature_experiment_as_dict(experiment), status=status.HTTP_201_CREATED)


@api_view(['GET'])
@owner_only
def feature_experiment_detail(request, experiment_id):
    experiment = FeatureExperiment.objects.select_related('started_from_feature_set').filter(id=experiment_id).first()
    if experiment is None:
        return Response({'error': f"No feature experiment {experiment_id}."}, status=status.HTTP_404_NOT_FOUND)
    return Response(feature_experiment_as_dict(experiment))


def as_plain_data(value):
    """Validated data as plain dicts and lists, for a JSON field."""
    if isinstance(value, dict):
        return {key: as_plain_data(item) for key, item in value.items()}
    if isinstance(value, list):
        return [as_plain_data(item) for item in value]
    return value
