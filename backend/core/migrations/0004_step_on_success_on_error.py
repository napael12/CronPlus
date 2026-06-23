from django.db import migrations, models
import django.db.models.deletion


def migrate_outcome_action(apps, schema_editor):
    Step = apps.get_model("core", "Step")
    for step in Step.objects.all():
        # Old "continue" = continue even on error → on_error = continue
        # Old "stop_on_error" = stop on error  → on_error = stop
        step.on_error = "continue" if step.outcome_action == "continue" else "stop"
        step.on_success = "continue"
        step.save(update_fields=["on_success", "on_error"])


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0003_appsetting_label_seed"),
    ]

    operations = [
        # Add new fields
        migrations.AddField(
            model_name="step",
            name="on_success",
            field=models.CharField(
                choices=[("continue", "Go to Next Step"), ("stop", "Stop Processing"), ("launch_workflow", "Launch Workflow")],
                default="continue",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="step",
            name="on_success_workflow",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="triggered_on_step_success",
                to="core.workflow",
            ),
        ),
        migrations.AddField(
            model_name="step",
            name="on_error",
            field=models.CharField(
                choices=[("continue", "Go to Next Step"), ("stop", "Stop Processing"), ("launch_workflow", "Launch Workflow")],
                default="stop",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="step",
            name="on_error_workflow",
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="triggered_on_step_error",
                to="core.workflow",
            ),
        ),
        # Migrate existing outcome_action data
        migrations.RunPython(migrate_outcome_action, migrations.RunPython.noop),
        # Drop old field
        migrations.RemoveField(
            model_name="step",
            name="outcome_action",
        ),
    ]
