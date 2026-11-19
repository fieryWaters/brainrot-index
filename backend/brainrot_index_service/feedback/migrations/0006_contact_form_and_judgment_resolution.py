import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feedback', '0005_feedback_reply_email'),
        ('classification', '0011_postjudgment'),
    ]

    operations = [
        migrations.AlterField(
            model_name='feedback',
            name='source',
            field=models.CharField(choices=[('site', 'Website'), ('extension', 'Extension'), ('contact', 'Contact form')], max_length=16),
        ),
        migrations.AddField(
            model_name='feedback',
            name='name',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='feedback',
            name='subject',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.CreateModel(
            name='JudgmentResolution',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('resolved_commit', models.CharField(blank=True, default='', max_length=64)),
                ('resolved_note', models.TextField()),
                ('resolved_at', models.DateTimeField(auto_now=True)),
                ('judgment', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='resolution', to='classification.postjudgment')),
            ],
        ),
    ]
