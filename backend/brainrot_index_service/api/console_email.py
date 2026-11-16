"""Email backend for EMAIL_DELIVERY=console: writes each email's plain-text
body to the log instead of sending it, so links can be copied straight from
`docker compose logs backend`. Django's own console backend prints the raw
MIME message, where quoted-printable encoding breaks long links across lines."""

import logging

from django.core.mail.backends.base import BaseEmailBackend

logger = logging.getLogger(__name__)


class ConsoleTextEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        for message in email_messages:
            logger.info(
                "Email not sent (EMAIL_DELIVERY=console)\nTo: %s\nSubject: %s\n\n%s",
                ', '.join(message.to),
                message.subject,
                message.body,
            )
        return len(email_messages)
