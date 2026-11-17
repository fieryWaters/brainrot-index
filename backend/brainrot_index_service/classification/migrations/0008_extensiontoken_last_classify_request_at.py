from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0007_official_store_plugins'),
    ]

    operations = [
        migrations.AddField(
            model_name='extensiontoken',
            name='last_classify_request_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
