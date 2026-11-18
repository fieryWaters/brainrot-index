from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feedback', '0003_alter_feedback_platform'),
    ]

    operations = [
        migrations.AddField(
            model_name='feedback',
            name='rating',
            field=models.CharField(blank=True, choices=[('up', 'Thumbs up'), ('down', 'Thumbs down')], default='', max_length=8),
        ),
    ]
