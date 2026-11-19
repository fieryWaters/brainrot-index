from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0015_unlist_body_pressure'),
    ]

    operations = [
        migrations.AddField(
            model_name='post',
            name='quoted_post',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='post',
            name='link_preview',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='post',
            name='video_url',
            field=models.TextField(blank=True, default=''),
        ),
    ]
