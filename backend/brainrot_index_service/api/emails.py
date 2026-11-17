import logging
import threading

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


def _build_frontend_url(path):
    base = getattr(settings, 'FRONTEND_BASE_URL', '').rstrip('/')
    if not path.startswith('/'):
        path = '/' + path
    return f"{base}{path}"


def _send_async(*, subject, recipient, text_body, html_body, log_tag):
    def _run():
        try:
            send_mail(
                subject=subject,
                message=text_body,
                from_email=None,
                recipient_list=[recipient],
                html_message=html_body,
            )
            logger.info("%s sent to %s", log_tag, recipient)
        except Exception as error:
            # Sending runs after the response, so this log line is the only
            # place a failure shows up.
            logger.error("%s to %s failed: %s: %s", log_tag, recipient, type(error).__name__, error, exc_info=True)

    threading.Thread(target=_run, daemon=True).start()


def send_email_verification(user, raw_token):
    recipient_email = user.email
    if not recipient_email:
        logger.warning("No email on user %s - skipping verification email", user.id)
        return

    verify_url = _build_frontend_url(f'/verify-email?token={raw_token}')
    html_body = render_to_string('email/email_verification.html', {
        'verify_url': verify_url,
    })
    text_body = (
        f"Welcome to Brainrot Index!\n\n"
        f"Tap the link below to verify your email:\n\n"
        f"{verify_url}\n\n"
        f"This link is good for 24 hours. If you didn't create an account, "
        f"you can safely ignore this email.\n"
    )
    _send_async(
        subject="Verify your email - Brainrot Index",
        recipient=recipient_email,
        text_body=text_body,
        html_body=html_body,
        log_tag="verification email",
    )


def send_password_reset(user, raw_token):
    recipient_email = user.email
    if not recipient_email:
        logger.warning("No email on user %s - skipping reset email", user.id)
        return

    reset_url = _build_frontend_url(f'/reset-password?token={raw_token}')
    html_body = render_to_string('email/password_reset.html', {
        'reset_url': reset_url,
    })
    text_body = (
        f"Reset your Brainrot Index password\n\n"
        f"Tap the link below to choose a new password. This link is good for "
        f"15 minutes and can only be used once.\n\n"
        f"{reset_url}\n\n"
        f"If you didn't request this, you can safely ignore this email.\n"
    )
    _send_async(
        subject="Reset your password - Brainrot Index",
        recipient=recipient_email,
        text_body=text_body,
        html_body=html_body,
        log_tag="password reset email",
    )
