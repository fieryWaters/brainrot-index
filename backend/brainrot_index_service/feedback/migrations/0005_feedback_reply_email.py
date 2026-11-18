from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feedback', '0004_feedback_rating'),
    ]

    operations = [
        migrations.AddField(
            model_name='feedback',
            name='reply_email',
            field=models.EmailField(blank=True, default='', max_length=254),
        ),
    ]
