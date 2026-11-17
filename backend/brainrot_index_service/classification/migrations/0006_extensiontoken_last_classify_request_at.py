from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0005_default_thresholds_for_gemini'),
    ]

    operations = [
        migrations.AddField(
            model_name='extensiontoken',
            name='last_classify_request_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
