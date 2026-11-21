from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from classification.models import FeatureSet
from tuning.feature_runs import create_experiment, filter_counts, run_now
from tuning.models import EXPERIMENT_FAILED, EXPERIMENT_RUNNING, FeatureExperiment

SWEEP_CUTOFFS = [10, 20, 30, 40, 50, 60, 70, 80, 90]


def counts_text(counts):
    text = f"{counts['right']} right, {counts['missed']} missed, {counts['wrongly_flagged']} wrongly blocked"
    if counts['failed']:
        text += f", {counts['failed']} failed"
    return text


def filter_lines(experiment, results):
    """Each filter against its test set, beside its live version, and the draft at other cutoffs."""
    lines = []
    for filter_definition in experiment.filters:
        slug = filter_definition['plugin']
        live = experiment.live[slug]
        lines.append('')
        lines.append(f"== {slug}: draft cutoff {filter_definition['cutoff']}, live v{live['version']} "
                     f"cutoff {live['threshold']} ==")
        counts = filter_counts(filter_definition, live, results)
        if counts['cases'] == 0:
            continue
        lines.append(f"owner's thumbs, {counts['cases']} posts:")
        lines.append(f"  draft: {counts_text(counts['draft'])}")
        lines.append(f"  live:  {counts_text(counts['live'])}")
        lines.append("  draft at other cutoffs: cutoff, right, missed, wrongly blocked")
        for cutoff in SWEEP_CUTOFFS:
            swept = filter_counts(filter_definition, live, results, cutoff)['draft']
            lines.append(f"    {cutoff:3d}  {swept['right']:4d}  {swept['missed']:4d}  {swept['wrongly_flagged']:4d}")
    return lines


class Command(BaseCommand):
    help = ("Runs a feature set experiment, as the tuning page does: every post is rated once on every feature, "
            "and each filter is measured on its test set of the owner's thumbs beside its live version. "
            "Uses production's model, so run it where the model key is set. "
            "The experiment is saved and opens on the tuning page at /tuning/features/<id>.")

    def add_arguments(self, parser):
        parser.add_argument('--from-experiment', type=int,
                            help="Use the features and filters of this feature experiment, such as a draft "
                                 "edited on the page. Default: the latest saved feature set.")
        parser.add_argument('--resume', type=int,
                            help="Finish this feature experiment, rating only the posts it has not rated yet.")
        parser.add_argument('--explain-every-case', action='store_true',
                            help="Ask why for every post, not only those some filter gets wrong or decides "
                                 "differently from live.")

    def handle(self, *args, **options):
        if options['resume'] is not None:
            experiment = FeatureExperiment.objects.filter(id=options['resume']).first()
            if experiment is None:
                raise CommandError(f"No feature experiment {options['resume']}.")
        else:
            experiment = self.new_experiment(options)
        self.stdout.write(f"Feature experiment {experiment.id} with {experiment.model} ({experiment.inference_source})")
        run_now(experiment)
        experiment.refresh_from_db()
        if experiment.status == EXPERIMENT_FAILED:
            raise CommandError(f"Feature experiment {experiment.id} failed: {experiment.error}")

        results = list(experiment.results.all())
        prompt_tokens = sum(result.prompt_tokens for result in results)
        cached_prompt_tokens = sum(result.cached_prompt_tokens for result in results)
        completion_tokens = sum(result.completion_tokens for result in results)
        costs = [result.cost for result in results if result.cost is not None]
        failed = sum(1 for result in results if result.failed)
        self.stdout.write(f"{len(results)} posts rated, {failed} with no usable answer. "
                          f"Tokens: {prompt_tokens} in ({cached_prompt_tokens} read from cache), "
                          f"{completion_tokens} out. Cost: "
                          + (f"${sum(costs):.4f}" if costs else "not reported") + ".")
        self.stdout.write('\n'.join(filter_lines(experiment, results)))
        self.stdout.write('')
        self.stdout.write(f"On the page: {settings.SITE_URL}/tuning/features/{experiment.id}")

    def new_experiment(self, options):
        if options['from_experiment'] is not None:
            source = FeatureExperiment.objects.filter(id=options['from_experiment']).first()
            if source is None:
                raise CommandError(f"No feature experiment {options['from_experiment']}.")
            return create_experiment(source.features, source.filters, options['explain_every_case'],
                                     started_from=source, status=EXPERIMENT_RUNNING)
        feature_set = FeatureSet.objects.order_by('-version').first()
        if feature_set is None:
            raise CommandError("No saved feature set.")
        return create_experiment(feature_set.features, feature_set.filters, options['explain_every_case'],
                                 started_from_feature_set=feature_set, status=EXPERIMENT_RUNNING)
