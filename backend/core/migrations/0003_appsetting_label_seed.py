import json
from pathlib import Path
from django.db import migrations, models

_CONFIG = Path(__file__).resolve().parent.parent.parent / "config" / "settings.json"


def seed_settings(apps, schema_editor):
    AppSetting = apps.get_model("core", "AppSetting")
    with open(_CONFIG) as f:
        defs = json.load(f)
    for s in defs:
        obj, created = AppSetting.objects.get_or_create(
            key=s["key"],
            defaults={"label": s["label"], "description": s["description"], "value": s["default"]},
        )
        if not created:
            obj.label = s["label"]
            obj.description = s["description"]
            obj.save(update_fields=["label", "description"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_alter_steprun_options"),
    ]

    operations = [
        migrations.AddField(
            model_name="appsetting",
            name="label",
            field=models.CharField(max_length=200, blank=True),
        ),
        migrations.RunPython(seed_settings, migrations.RunPython.noop),
    ]
