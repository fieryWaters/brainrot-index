"""Single-use token helpers for email verification and password reset.

We store only the SHA-256 hash of the token in the database. The raw token
lives in the outbound email. This way, a database leak never leaks working
tokens - the attacker would need both the database contents AND the email
delivery stream.
"""

import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone


def generate_raw_token():
    """Cryptographically strong random token for email verification / reset.

    48 bytes -> 64-char url-safe base64 string. Not guessable.
    """
    return secrets.token_urlsafe(48)


def hash_token(raw_token):
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


def token_is_valid(token_row):
    """Returns True iff the token row is present, unconsumed, and unexpired."""
    if token_row.consumed_at is not None:
        return False
    if token_row.expires_at < timezone.now():
        return False
    return True


def compute_expiry(minutes):
    return timezone.now() + timedelta(minutes=minutes)


EMAIL_VERIFICATION_TTL_MINUTES = 60 * 24     # 24 hours
PASSWORD_RESET_TTL_MINUTES = 15                # 15 minutes
