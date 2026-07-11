from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0006_notification_mailhost_user_setting"),
    ]

    operations = [
        migrations.AlterField(
            model_name="workflowrun",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("running", "Running"),
                    ("success", "Success"),
                    ("failed", "Failed"),
                    ("stopped", "Stopped"),
                    ("skipped", "Skipped"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="steprun",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("running", "Running"),
                    ("success", "Success"),
                    ("failed", "Failed"),
                    ("timeout", "Timeout"),
                    ("stopped", "Stopped"),
                    ("skipped", "Skipped"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
    ]
