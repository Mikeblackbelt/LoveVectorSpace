"""Outgoing mail: Resend HTTP API, or a console mailer for development.

Only ConsoleMailer ever prints a link; ResendMailer never logs bodies, links or recipients' tokens.
"""
from __future__ import annotations

import logging
from typing import Protocol

import httpx

log = logging.getLogger("analyzer.mail")


class Mailer(Protocol):
    def send(self, to: str, subject: str, text: str, link: str) -> None: ...


class ConsoleMailer:
    """Dev-only fallback used when RESEND_API_KEY is not set: logs the link so a developer can click it."""

    def send(self, to: str, subject: str, text: str, link: str) -> None:
        log.warning("DEV MAILER (no RESEND_API_KEY): %s -> %s", subject, link)


class ResendMailer:
    URL = "https://api.resend.com/emails"

    def __init__(self, api_key: str, sender: str, transport: httpx.BaseTransport | None = None):
        self._key = api_key
        self._from = sender
        self._transport = transport

    def send(self, to: str, subject: str, text: str, link: str) -> None:
        try:
            with httpx.Client(transport=self._transport, timeout=10.0) as c:
                r = c.post(self.URL, headers={"Authorization": f"Bearer {self._key}"},
                           json={"from": self._from, "to": [to], "subject": subject, "text": f"{text}\n\n{link}\n"})
            if r.status_code >= 400:
                log.error("mail send failed: status=%s subject=%s", r.status_code, subject)
        except httpx.HTTPError as e:
            log.error("mail send failed: %s subject=%s", type(e).__name__, subject)
