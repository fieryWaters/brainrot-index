from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from classification.evaluation import (
    classify_example,
    load_examples,
    load_results,
    plugin_summary_lines,
    results_file_path,
    save_results,
    worst_misses_lines,
)
from classification.inference import INFERENCE_SOURCE_LOCAL, INFERENCE_SOURCE_OPENROUTER
from classification.models import Plugin, PluginVersion

PROGRESS_EVERY = 50


class Command(BaseCommand):
    help = ("Scores a model and rubric versions against a labeled dataset (eval/dataset.jsonl), "
            "writing results to eval/results/ and printing a summary. Re-running the same "
            "configuration resumes it.")

    def add_arguments(self, parser):
        parser.add_argument('--dataset', required=True, help="Path to a JSONL dataset.")
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
        dataset_path = Path(options['dataset'])
        examples = load_examples(dataset_path)
        plugin_versions = self.chosen_plugin_versions(examples, options['plugin'], options['rubric_version'])
        inference_source = options['inference_source']
        model = options['model']

        explain = options['explain']
        results_path = results_file_path(dataset_path, inference_source, model, plugin_versions, explain)
        results = load_results(results_path, dataset_path, inference_source, model, plugin_versions)
        # Failed answers are asked again; scored ones are kept.
        results['results'] = [record for record in results['results'] if not record['failed']]
        scored_keys = {(record['example_id'], record['plugin']) for record in results['results']}

        work = []
        for example in examples:
            for plugin_version in plugin_versions:
                slug = plugin_version.plugin.slug
                if slug in example.get('expected', {}) and (example['id'], slug) not in scored_keys:
                    work.append((example, plugin_version))

        self.stdout.write(f"Results file: {results_path}")
        self.stdout.write(f"{len(scored_keys)} already scored, {len(work)} to classify with {model}")
        images_dir = dataset_path.parent / 'images'
        with ThreadPoolExecutor(max_workers=options['concurrency']) as executor:
            futures = [
                executor.submit(classify_example, example, plugin_version, images_dir, inference_source, model, explain)
                for example, plugin_version in work
            ]
            for finished_count, future in enumerate(as_completed(futures), start=1):
                results['results'].append(future.result())
                save_results(results_path, results)
                if finished_count % PROGRESS_EVERY == 0:
                    self.stdout.write(f"{finished_count} of {len(work)} classified")

        records_by_key = {(record['example_id'], record['plugin']): record for record in results['results']}
        for plugin_version in plugin_versions:
            self.stdout.write('')
            self.stdout.write('\n'.join(plugin_summary_lines(plugin_version, examples, records_by_key)))
        self.stdout.write('')
        self.stdout.write('\n'.join(worst_misses_lines(plugin_versions, examples, records_by_key)))

    def chosen_plugin_versions(self, examples, plugin_slug, rubric_version):
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

        labeled_slugs = set()
        for example in examples:
            labeled_slugs.update(example.get('expected', {}))
        plugins = Plugin.objects.filter(slug__in=labeled_slugs).order_by('id')
        return [plugin.latest_version() for plugin in plugins]
