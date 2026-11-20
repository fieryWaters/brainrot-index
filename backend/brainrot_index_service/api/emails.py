import logging
import threading

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


def _build_frontend_url(path):
    base = getattr(settings, 'FRONTEND_BASE_URL', '').rstrip('/')
    if not path.startswith('/'):
        path = '/' + path
    return f"{base}{path}"


def _send_async(*, subject, recipient, text_body, html_body, log_tag, reply_to=None):
    def _run():
        try:
            message = EmailMultiAlternatives(
                subject=subject, body=text_body, to=[recipient], reply_to=reply_to)
            if html_body:
                message.attach_alternative(html_body, 'text/html')
            message.send()
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
        f"Welcome to BrainRot Index!\n\n"
        f"Tap the link below to verify your email:\n\n"
        f"{verify_url}\n\n"
        f"This link is good for 24 hours. If you didn't create an account, "
        f"you can safely ignore this email.\n"
    )
    _send_async(
        subject="Verify your email - BrainRot Index",
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
        f"Reset your BrainRot Index password\n\n"
        f"Tap the link below to choose a new password. This link is good for "
        f"15 minutes and can only be used once.\n\n"
        f"{reset_url}\n\n"
        f"If you didn't request this, you can safely ignore this email.\n"
    )
    _send_async(
        subject="Reset your password - BrainRot Index",
        recipient=recipient_email,
        text_body=text_body,
        html_body=html_body,
        log_tag="password reset email",
    )


def send_feedback_alert(feedback):
    """Tells the admin a contact message arrived; the site has no support
    mailbox. Replying to the email answers the sender."""
    if not settings.ADMIN_EMAIL:
        logger.warning("ADMIN_EMAIL is not set - skipping alert for feedback %s", feedback.id)
        return

    if feedback.user is not None:
        sender = feedback.user.email
    elif feedback.reply_email:
        sender = f"{feedback.reply_email} (not signed in)"
    else:
        sender = "someone not signed in, no reply address"

    # The address the sender typed comes first: the contact form asks for one
    # even from someone signed in.
    if feedback.reply_email:
        reply_to = [feedback.reply_email]
    elif feedback.user is not None:
        reply_to = [feedback.user.email]
    else:
        reply_to = []

    details = [
        f"From: {sender}",
        f"Source: {feedback.get_source_display()}",
    ]
    if feedback.name:
        details.append(f"Name: {feedback.name}")
    if feedback.subject:
        details.append(f"Subject: {feedback.subject}")
    if feedback.rating:
        details.append(f"Rating: {feedback.get_rating_display()}")
    if feedback.platform:
        details.append(f"Platform: {feedback.get_platform_display()}")
    if feedback.post_id:
        details.append(f"Post: {feedback.post_id}")
    if feedback.shown_action or feedback.expected_action:
        details.append(f"Shown: {feedback.shown_action or '-'}, expected: {feedback.expected_action or '-'}")
    if feedback.page_url:
        details.append(f"Page: {feedback.page_url}")

    inbox_url = _build_frontend_url(f'/inbox/feedback-{feedback.id}')
    if feedback.subject:
        subject = f"Contact {feedback.id}: {feedback.subject} - BrainRot Index"
    else:
        subject = f"Feedback {feedback.id} - BrainRot Index"
    text_body = (
        "New feedback\n\n"
        + "\n".join(details)
        + f"\n\n{feedback.text or '(no text)'}\n\n"
        + f"Open it in the inbox: {inbox_url}\n"
    )
    _send_async(
        subject=subject,
        recipient=settings.ADMIN_EMAIL,
        text_body=text_body,
        html_body=None,
        log_tag="feedback alert",
        reply_to=reply_to,
    )
