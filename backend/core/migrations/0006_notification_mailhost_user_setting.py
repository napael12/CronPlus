from django.db import migrations


def add_setting(apps, schema_editor):
    AppSetting = apps.get_model("core", "AppSetting")
    AppSetting.objects.get_or_create(
        key="notification_mailhost_user",
        defaults={
            "label": "Mailhost User",
            "description": "SMTP authentication username for notification emails",
            "value": "",
        },
    )


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0005_notification_mailhost_password_setting"),
    ]

    operations = [
        migrations.RunPython(add_setting, migrations.RunPython.noop),
    ]
