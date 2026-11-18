from django.conf import settings
from django.db import models


# An admin changes anyone's settings, plugins and roles in the family.
# An adult changes only their own. A child changes nothing and sees what an
# admin applies to them.
ROLE_ADMIN = 'admin'
ROLE_ADULT = 'adult'
ROLE_CHILD = 'child'
ROLE_CHOICES = [
    (ROLE_ADMIN, 'Admin'),
    (ROLE_ADULT, 'Adult'),
    (ROLE_CHILD, 'Child'),
]


class Family(models.Model):
    """People who filter their feeds together. Its admins manage everyone. A
    family is made the first time someone with none invites another person."""

    # Unused: a family is known by its members. Kept for families named before.
    name = models.CharField(max_length=60, blank=True, default='')
    # The account that created the family and became its first admin.
    # When payments exist, the person who pays is tied to the family here.
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_families',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'families'

    def __str__(self):
        return f"family {self.id}"


class FamilyMember(models.Model):
    """A user's place in a family. A user belongs to at most one family; a
    user with none is treated as their own admin."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='family_membership')
    family = models.ForeignKey(Family, on_delete=models.PROTECT, related_name='members')
    role = models.CharField(max_length=16, choices=ROLE_CHOICES)
    joined_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user} ({self.role}) in {self.family}"


class FamilyInvite(models.Model):
    """A single-use code that adds whoever accepts it to the family with the
    chosen role. Stores only the SHA-256 hash of the code."""

    family = models.ForeignKey(Family, on_delete=models.PROTECT, related_name='invites')
    role = models.CharField(max_length=16, choices=ROLE_CHOICES)
    code_hash = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='+',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='+',
    )
    accepted_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"invite {self.id} to {self.family} as {self.role}"
