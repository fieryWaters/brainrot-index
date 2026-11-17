"""Invite codes. While SIGNUP_REQUIRES_INVITE is on, creating an account
(by email or by Google) uses up one use of a code."""

from django.db.models import F

from .models import InviteCode


def _usable_invite_codes(raw_code):
    code = str(raw_code or '').strip().upper()
    return InviteCode.objects.filter(code=code, active=True, uses__lt=F('max_uses'))


def invite_code_is_usable(raw_code):
    return _usable_invite_codes(raw_code).exists()


def redeem_invite_code(raw_code):
    """Uses up one use of the code. False when the code has no uses left."""
    redeemed_count = _usable_invite_codes(raw_code).update(uses=F('uses') + 1)
    return redeemed_count == 1


def invite_refusal(raw_code):
    """The response body for a sign-up refused for want of a usable code."""
    if not str(raw_code or '').strip():
        return {
            "error": "Creating an account needs an invite code.",
            "code": "invite_required",
        }
    return {
        "error": "That invite code is not valid or has been used up.",
        "code": "invite_invalid",
    }
