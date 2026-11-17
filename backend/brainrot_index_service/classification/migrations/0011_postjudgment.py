import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('classification', '0010_transcript_source_and_post_submissions'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PostJudgment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('verdict', models.CharField(choices=[('right', 'Right (thumbs up)'), ('wrong', 'Wrong (thumbs down)')], max_length=16)),
                ('shown_action', models.CharField(choices=[('allow', 'Shown'), ('blur', 'Blurred'), ('hide', 'Hidden')], max_length=16)),
                ('severity', models.CharField(blank=True, choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High')], default='', max_length=16)),
                ('details', models.TextField(blank=True, default='')),
                ('filter_results', models.JSONField(blank=True, default=list)),
                ('extension_commit', models.CharField(blank=True, default='', max_length=64)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('plugin', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='judgments', to='classification.plugin')),
                ('post', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='judgments', to='classification.post')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='post_judgments', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('user', 'post'), name='unique_judgment_per_user_and_post')],
            },
        ),
    ]
