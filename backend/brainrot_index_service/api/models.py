import secrets

from django.conf import settings
from django.db import models


AUTH_PROVIDER_GOOGLE = 'google'
AUTH_PROVIDER_PASSWORD = 'password'
AUTH_PROVIDER_HYBRID = 'hybrid'

AUTH_PROVIDER_CHOICES = [
    (AUTH_PROVIDER_GOOGLE, 'Google'),
    (AUTH_PROVIDER_PASSWORD, 'Password'),
    (AUTH_PROVIDER_HYBRID, 'Google + Password'),
]


class UserProfile(models.Model):
    """One-to-one extension of auth_user that tracks email auth state."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='profile',
    )
    email_verified = models.BooleanField(default=False)
    auth_provider = models.CharField(
        max_length=16,
        choices=AUTH_PROVIDER_CHOICES,
        default=AUTH_PROVIDER_PASSWORD,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.email or self.user.username} ({self.auth_provider})"


class EmailVerificationToken(models.Model):
    """Single-use email verification tokens. Stores SHA-256 hash, never raw.

    pending_password_hash carries the signup-time password hash until the user
    clicks the verification link. Until then the user row has an unusable
    password, so a pre-registered email can't be leveraged to plant credentials
    before the real owner proves inbox control.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='email_verification_tokens',
    )
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    pending_password_hash = models.CharField(max_length=256, blank=True, default='')

    def __str__(self):
        consumed = 'consumed' if self.consumed_at else 'pending'
        return f"verify {self.user_id} ({consumed})"


class PasswordResetToken(models.Model):
    """Single-use password reset tokens. Stores SHA-256 hash, never raw."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='password_reset_tokens',
    )
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        consumed = 'consumed' if self.consumed_at else 'pending'
        return f"reset {self.user_id} ({consumed})"


INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'  # no 0, O, 1 or I


def generate_invite_code():
    """Twelve random characters in three groups, for example K7QM-2XRA-PW9D."""
    characters = ''.join(secrets.choice(INVITE_CODE_ALPHABET) for _ in range(12))
    return f"{characters[0:4]}-{characters[4:8]}-{characters[8:12]}"


class InviteCode(models.Model):
    """A code that lets up to max_uses new accounts sign up."""

    code = models.CharField(max_length=32, unique=True, default=generate_invite_code)
    note = models.CharField(max_length=200, blank=True, help_text='Who the code was given to.')
    max_uses = models.PositiveIntegerField(default=1)
    uses = models.PositiveIntegerField(default=0)
    active = models.BooleanField(default=True)
    created = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.code} ({self.uses}/{self.max_uses})"


class DailyNewPostCount(models.Model):
    """How many posts one account sent for classification on one day (UTC)
    that had no classification yet. Limited by DAILY_NEW_POST_QUOTA."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='daily_new_post_counts',
    )
    day = models.DateField()
    count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'day'], name='one_daily_new_post_count_per_user_and_day'),
        ]

    def __str__(self):
        return f"{self.user_id} on {self.day}: {self.count}"
