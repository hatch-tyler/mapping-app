import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import aiosmtplib

from app.config import settings

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending emails via SMTP."""

    def __init__(self):
        self.host = settings.SMTP_HOST
        self.port = settings.SMTP_PORT
        self.username = settings.SMTP_USER
        self.password = settings.SMTP_PASSWORD
        self.from_email = settings.SMTP_FROM_EMAIL
        self.from_name = settings.SMTP_FROM_NAME

    @property
    def is_configured(self) -> bool:
        """Check if SMTP is configured."""
        return bool(self.host and self.username and self.password)

    async def send_email(self, to: str, subject: str, html_content: str) -> bool:
        """Send an HTML email.

        Returns True if sent successfully, False otherwise.
        """
        if not self.is_configured:
            logger.warning(f"SMTP not configured. Would have sent email to {to}: {subject}")
            return False

        message = MIMEMultipart("alternative")
        message["From"] = f"{self.from_name} <{self.from_email}>"
        message["To"] = to
        message["Subject"] = subject
        message.attach(MIMEText(html_content, "html"))

        try:
            await aiosmtplib.send(
                message,
                hostname=self.host,
                port=self.port,
                username=self.username,
                password=self.password,
                start_tls=True,
            )
            logger.info(f"Email sent to {to}: {subject}")
            return True
        except Exception as e:
            logger.error(f"Failed to send email to {to}: {e}")
            return False

    async def send_admin_new_registration(
        self, email: str, full_name: str | None
    ) -> bool:
        """Notify admin of a new registration request."""
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: #2563eb; color: white; padding: 20px; text-align: center; }}
                .content {{ padding: 20px; background-color: #f9fafb; }}
                .button {{ display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; }}
                .info {{ background-color: white; padding: 15px; border-radius: 6px; margin: 15px 0; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>New Registration Request</h1>
                </div>
                <div class="content">
                    <p>A new user has requested access to the GIS application.</p>
                    <div class="info">
                        <p><strong>Name:</strong> {full_name or 'Not provided'}</p>
                        <p><strong>Email:</strong> {email}</p>
                    </div>
                    <p style="text-align: center;">
                        <a href="{settings.APP_URL}/admin" class="button">Review in Admin Panel</a>
                    </p>
                </div>
            </div>
        </body>
        </html>
        """
        return await self.send_email(
            settings.ADMIN_EMAIL,
            "New Registration Request",
            html
        )

    async def send_registration_approved(
        self, email: str, full_name: str | None
    ) -> bool:
        """Notify user that their registration was approved."""
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: #16a34a; color: white; padding: 20px; text-align: center; }}
                .content {{ padding: 20px; background-color: #f9fafb; }}
                .button {{ display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Registration Approved</h1>
                </div>
                <div class="content">
                    <p>Hello {full_name or 'User'},</p>
                    <p>Your registration request has been approved. You can now log in to the GIS application using your email and password.</p>
                    <p style="text-align: center; margin-top: 20px;">
                        <a href="{settings.APP_URL}/login" class="button">Login Now</a>
                    </p>
                </div>
            </div>
        </body>
        </html>
        """
        return await self.send_email(email, "Registration Approved", html)

    async def send_registration_rejected(
        self, email: str, full_name: str | None, reason: str | None = None
    ) -> bool:
        """Notify user that their registration was rejected."""
        reason_html = f"<p><strong>Reason:</strong> {reason}</p>" if reason else ""

        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: #dc2626; color: white; padding: 20px; text-align: center; }}
                .content {{ padding: 20px; background-color: #f9fafb; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Registration Status Update</h1>
                </div>
                <div class="content">
                    <p>Hello {full_name or 'User'},</p>
                    <p>We were unable to approve your registration request at this time.</p>
                    {reason_html}
                    <p>If you believe this was in error, please contact the administrator.</p>
                </div>
            </div>
        </body>
        </html>
        """
        return await self.send_email(email, "Registration Status Update", html)

    async def send_email_confirmation(
        self, email: str, full_name: str | None, token: str, expire_hours: int = 24
    ) -> bool:
        """Send email confirmation link to user.

        Returns True if email sent, False if SMTP not configured (URL will be printed).
        """
        confirmation_url = f"{settings.APP_URL}/confirm-email?token={token}"

        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; color: #333; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: #2563eb; color: white; padding: 20px; text-align: center; }}
                .content {{ padding: 20px; background-color: #f9fafb; }}
                .button {{ display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; }}
                .warning {{ background-color: #fef3c7; border: 1px solid #f59e0b; padding: 12px; border-radius: 6px; margin: 15px 0; }}
                .url {{ word-break: break-all; background-color: #f3f4f6; padding: 10px; border-radius: 4px; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Confirm Your Email</h1>
                </div>
                <div class="content">
                    <p>Hello {full_name or 'User'},</p>
                    <p>Please confirm your email address to activate your account.</p>
                    <p style="text-align: center; margin: 25px 0;">
                        <a href="{confirmation_url}" class="button">Confirm Email</a>
                    </p>
                    <div class="warning">
                        <strong>⚠️ Important:</strong> This link will expire in {expire_hours} hours.
                    </div>
                    <p>If the button doesn't work, copy and paste this URL into your browser:</p>
                    <p class="url">{confirmation_url}</p>
                </div>
            </div>
        </body>
        </html>
        """
        return await self.send_email(email, "Confirm Your Email Address", html)

    def get_confirmation_url(self, token: str) -> str:
        """Get the confirmation URL for a token (for console output when SMTP not configured)."""
        return f"{settings.APP_URL}/confirm-email?token={token}"


# Singleton instance
email_service = EmailService()
