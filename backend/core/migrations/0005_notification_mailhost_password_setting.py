from django.db import migrations


def add_setting(apps, schema_editor):
    AppSetting = apps.get_model("core", "AppSetting")
    AppSetting.objects.get_or_create(
        key="notification_mailhost_password",
        defaults={
            "label": "Mailhost Password",
            "description": "SMTP authentication password for notification emails",
            "value": "",
        },
    )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0004_step_on_success_on_error"),
    ]

    operations = [
        migrations.RunPython(add_setting, migrations.RunPython.noop),
    ]
