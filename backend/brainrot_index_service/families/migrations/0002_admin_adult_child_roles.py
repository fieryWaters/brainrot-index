"""Renames the family roles to what people call them: superadmin becomes
admin (full control), admin becomes adult (their own settings only), child
stays child. Every member and invite keeps the same powers. A family no
longer needs a name, so the name may be blank."""

from django.db import migrations, models
from django.db.models import Case, Value, When

ROLE_CHOICES = [('admin', 'Admin'), ('adult', 'Adult'), ('child', 'Child')]

# Each mapping is applied in one UPDATE, so 'admin' is never renamed twice.
OLD_TO_NEW = {'superadmin': 'admin', 'admin': 'adult'}
NEW_TO_OLD = {'admin': 'superadmin', 'adult': 'admin'}


def rename_roles(apps, mapping):
    for model_name in ['FamilyMember', 'FamilyInvite']:
        model = apps.get_model('families', model_name)
        model.objects.filter(role__in=mapping.keys()).update(role=Case(
            *[When(role=old, then=Value(new)) for old, new in mapping.items()],
        ))


def forwards(apps, schema_editor):
    rename_roles(apps, OLD_TO_NEW)


def backwards(apps, schema_editor):
    rename_roles(apps, NEW_TO_OLD)


class Migration(migrations.Migration):

    dependencies = [
        ('families', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='family',
            name='name',
            field=models.CharField(blank=True, default='', max_length=60),
        ),
        migrations.AlterField(
            model_name='familymember',
            name='role',
            field=models.CharField(choices=ROLE_CHOICES, max_length=16),
        ),
        migrations.AlterField(
            model_name='familyinvite',
            name='role',
            field=models.CharField(choices=ROLE_CHOICES, max_length=16),
        ),
        migrations.RunPython(forwards, backwards),
    ]
