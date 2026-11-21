from django.db import migrations

# Two features at their second of three steps above none, such as "driven by
# hooks" and "thin", make 6.7 x 6.7 = 44.9. That is brainrot, so the cutoff
# sits below it; at 50 a post needed one feature at its very top.
BRAINROT_CUTOFF = 40


def add_feature_set_2(apps, schema_editor):
    """Version 1 with the brainrot cutoff lowered."""
    FeatureSet = apps.get_model('classification', 'FeatureSet')
    first = FeatureSet.objects.get(version=1)
    filters = []
    for filter_definition in first.filters:
        if filter_definition['plugin'] == 'brainrot':
            filter_definition = {**filter_definition, 'cutoff': BRAINROT_CUTOFF}
        filters.append(filter_definition)
    FeatureSet.objects.create(version=2, features=first.features, filters=filters)


def remove_feature_set_2(apps, schema_editor):
    apps.get_model('classification', 'FeatureSet').objects.filter(version=2).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0024_feature_sets'),
    ]

    operations = [
        migrations.RunPython(add_feature_set_2, remove_feature_set_2),
    ]
