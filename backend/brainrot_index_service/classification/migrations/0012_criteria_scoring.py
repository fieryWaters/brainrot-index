from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0011_postjudgment'),
    ]

    operations = [
        migrations.AddField(
            model_name='pluginversion',
            name='criteria',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='classification',
            name='criteria_met',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
