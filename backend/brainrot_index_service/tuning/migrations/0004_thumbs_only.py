from django.db import migrations, models
from django.db.models import Count, F


def remove_synthetic_results(apps, schema_editor):
    """Experiments are measured on the owner's thumbs only. The results of
    the synthetic test set go, and each experiment that judged it counts
    only the thumbs among its cases."""
    for experiment_name, result_name in [('TuningExperiment', 'TuningResult'), ('FeatureExperiment', 'FeatureResult')]:
        Experiment = apps.get_model('tuning', experiment_name)
        Result = apps.get_model('tuning', result_name)
        synthetic_results = Result.objects.filter(source='synthetic')
        counts = synthetic_results.values('experiment_id').annotate(synthetic_cases=Count('id'))
        for count in counts:
            Experiment.objects.filter(id=count['experiment_id'], total_cases__isnull=False).update(
                total_cases=F('total_cases') - count['synthetic_cases'])
        synthetic_results.delete()


class Migration(migrations.Migration):

    dependencies = [
        ('tuning', '0003_feature_experiments'),
    ]

    # Every result left is a thumbs, so a source of thumb is what undoing this would put back.
    operations = [
        migrations.RunPython(remove_synthetic_results, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='tuningresult',
            name='source',
            field=models.CharField(default='thumb', max_length=16),
        ),
        migrations.AlterField(
            model_name='featureresult',
            name='source',
            field=models.CharField(default='thumb', max_length=16),
        ),
        migrations.RemoveField(
            model_name='tuningexperiment',
            name='include_synthetic',
        ),
        migrations.RemoveField(
            model_name='tuningresult',
            name='source',
        ),
        migrations.RemoveField(
            model_name='featureexperiment',
            name='include_synthetic',
        ),
        migrations.RemoveField(
            model_name='featureresult',
            name='source',
        ),
    ]
