import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from django.conf import settings

logger = logging.getLogger(__name__)

_SUBJECT_TEMPLATE = "CronPlus {instance} - {workflow}: {status}"

_BODY_TEMPLATE = """\
Workflow: {workflow}
Project:  {project}
Status:   {status}
Started:  {started_at}
Finished: {finished_at}
Duration: {duration}

{error_excerpt}
"""


def _parse_host_port(mailhost_raw, default_port=25):
    """Split 'host:port' into (host, port). Falls back to default_port if no port given."""
    if ":" in mailhost_raw:
        host, port_str = mailhost_raw.rsplit(":", 1)
        try:
            return host.strip(), int(port_str.strip())
        except ValueError:
            return mailhost_raw.strip(), default_port
    return mailhost_raw.strip(), default_port


def send_workflow_notification(workflow_run):
    from core.models import AppSetting

    def setting(key, default=""):
        try:
            return AppSetting.objects.get(key=key).value
        except AppSetting.DoesNotExist:
            return getattr(settings, key.upper(), default)

    mailhost_raw = setting("notification_mailhost")
    if not mailhost_raw:
        return  # notifications not configured

    mailhost, port = _parse_host_port(mailhost_raw, default_port=settings.NOTIFICATION_PORT)
    sender = setting("notification_sender") or settings.NOTIFICATION_SENDER
    username = setting("notification_mailhost_user")
    password = setting("notification_mailhost_password")
    instance = setting("cronplus_instance_name") or settings.CRONPLUS_INSTANCE_NAME

    workflow = workflow_run.workflow
    recipients_raw = workflow.notification_recipients.strip()
    if not recipients_raw:
        return
    recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

    status = workflow_run.status
    started = workflow_run.started_at.strftime("%Y-%m-%d %H:%M:%S UTC") if workflow_run.started_at else "—"
    finished = workflow_run.finished_at.strftime("%Y-%m-%d %H:%M:%S UTC") if workflow_run.finished_at else "—"
    duration = (
        f"{workflow_run.duration_seconds:.1f}s" if workflow_run.duration_seconds else "—"
    )

    # Include first stderr excerpt from any failed step
    error_excerpt = ""
    failed_steps = workflow_run.step_runs.filter(
        status__in=["failed", "timeout"]
    ).exclude(stderr="").order_by("started_at")[:1]
    if failed_steps:
        error_excerpt = f"Error output ({failed_steps[0].step_name}):\n{failed_steps[0].stderr[:500]}"

    subject = _SUBJECT_TEMPLATE.format(
        instance=instance, workflow=workflow.name, status=status.upper()
    )
    body = _BODY_TEMPLATE.format(
        workflow=workflow.name,
        project=workflow.project.name,
        status=status.upper(),
        started_at=started,
        finished_at=finished,
        duration=duration,
        error_excerpt=error_excerpt,
    )

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(body, "plain"))

    try:
        with smtplib.SMTP(mailhost, port, timeout=10) as smtp:
            if password:
                smtp.starttls()
                smtp.login(username or sender, password)
            smtp.sendmail(sender, recipients, msg.as_string())
    except Exception as exc:
        logger.error("Failed to send notification for workflow_run %s: %s", workflow_run.pk, exc)
