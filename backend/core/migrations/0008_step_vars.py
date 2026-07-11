from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0007_stopped_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="workflowrun",
            name="runtime_vars",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="steprun",
            name="output_vars",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
