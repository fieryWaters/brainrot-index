from concurrent.futures import ThreadPoolExecutor, as_completed

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q

from classification.evaluation import (
    classify_example,
    judged_examples,
    owner_judgments,
    plugin_summary_lines,
    worst_misses_lines,
)
from classification.inference import INFERENCE_SOURCE_LOCAL, INFERENCE_SOURCE_OPENROUTER
from classification.models import Plugin, PluginVersion

PROGRESS_EVERY = 50


class Command(BaseCommand):
    help = ("Scores a model and rubric versions against the owner's thumbs and prints a summary. "
            "A thumbs labeled should be shown is a case for every filter; one labeled should be "
            "blocked as a filter is a case for that filter only.")

    def add_arguments(self, parser):
        parser.add_argument('--inference-source', required=True,
                            choices=[INFERENCE_SOURCE_OPENROUTER, INFERENCE_SOURCE_LOCAL])
        parser.add_argument('--model', required=True, help="Model name, such as google/gemini-2.5-flash-lite.")
        parser.add_argument('--plugin', help="Evaluate only this plugin slug.")
        parser.add_argument('--rubric-version', type=int, help="Rubric version of --plugin; default the latest.")
        parser.add_argument('--concurrency', type=int, default=8, help="Model requests in flight at once.")
        parser.add_argument('--explain', action='store_true',
                            help="For debugging: the model also explains, for each criterion, why it judged it "
                                 "met or not met. The prompt differs from production, so answers can differ too.")

    def handle(self, *args, **options):
        plugin_versions = self.chosen_plugin_versions(options['plugin'], options['rubric_version'])
        examples = judged_examples([plugin_version.plugin.slug for plugin_version in plugin_versions])
        inference_source = options['inference_source']
        model = options['model']

        work = []
        for example in examples:
            for plugin_version in plugin_versions:
                if plugin_version.plugin.slug in example['expected']:
                    work.append((example, plugin_version))

        self.stdout.write(f"{len(examples)} thumbs, {len(work)} to classify with {model}")
        records = []
        with ThreadPoolExecutor(max_workers=options['concurrency']) as executor:
            futures = [
                executor.submit(classify_example, example, plugin_version, inference_source, model, options['explain'])
                for example, plugin_version in work
            ]
            for finished_count, future in enumerate(as_completed(futures), start=1):
                records.append(future.result())
                if finished_count % PROGRESS_EVERY == 0:
                    self.stdout.write(f"{finished_count} of {len(work)} classified")

        records_by_key = {(record['example_id'], record['plugin']): record for record in records}
        for plugin_version in plugin_versions:
            self.stdout.write('')
            self.stdout.write('\n'.join(plugin_summary_lines(plugin_version, examples, records_by_key)))
        self.stdout.write('')
        self.stdout.write('\n'.join(worst_misses_lines(plugin_versions, examples, records_by_key)))

    def chosen_plugin_versions(self, plugin_slug, rubric_version):
        if rubric_version is not None and plugin_slug is None:
            raise CommandError("--rubric-version needs --plugin.")

        if plugin_slug is not None:
            plugin = Plugin.objects.filter(slug=plugin_slug).first()
            if plugin is None:
                raise CommandError(f"No plugin with slug {plugin_slug}.")
            if rubric_version is None:
                return [plugin.latest_version()]
            plugin_version = PluginVersion.objects.filter(plugin=plugin, version=rubric_version).first()
            if plugin_version is None:
                raise CommandError(f"{plugin_slug} has no version {rubric_version}.")
            return [plugin_version]

        # Every default filter, and any other filter a thumbs blocks a post as.
        named_by_thumbs = owner_judgments().values('plugin')
        plugins = Plugin.objects.filter(Q(is_baseline=True) | Q(id__in=named_by_thumbs)).order_by('id')
        return [plugin.latest_version() for plugin in plugins]
