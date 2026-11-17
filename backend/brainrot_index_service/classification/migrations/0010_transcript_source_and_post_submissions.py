import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0009_youtube_video_transcripts'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='videotranscript',
            name='source',
            field=models.CharField(blank=True, choices=[('browser', 'Browser'), ('server', 'Server')], default='', max_length=16),
        ),
        # Every transcript stored before this migration was downloaded by the server.
        migrations.RunSQL(
            "UPDATE classification_videotranscript SET source = 'server' WHERE status <> 'pending'",
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.CreateModel(
            name='PostSubmission',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('first_seen_at', models.DateTimeField()),
                ('last_seen_at', models.DateTimeField()),
                ('times_seen', models.PositiveIntegerField(default=1)),
                ('extension_token', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, to='classification.extensiontoken')),
                ('post', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='submissions', to='classification.post')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='post_submissions', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'indexes': [models.Index(fields=['user', 'last_seen_at'], name='submissions_by_user_and_time')],
                'constraints': [models.UniqueConstraint(fields=('user', 'post'), name='unique_submission_per_user_and_post')],
            },
        ),
    ]
