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
