"""Demo data: three organizations matching tenants in the ClickHouse seed, one
user each, plus "mallory", who belongs to no organization."""

from django.db import migrations

DEMO = [
    ("ada", "Quartz Metrics", "enterprise", 153),
    ("grace", "Relay Works", "growth", 170),
    ("linus", "Helix Analytics", "starter", 146),
]


def create_demo_users(apps, schema_editor):
    User = apps.get_model("auth", "User")
    Organization = apps.get_model("accounts", "Organization")
    Membership = apps.get_model("accounts", "Membership")
    for username, org_name, plan, tenant_id in DEMO:
        org = Organization.objects.create(name=org_name, plan=plan, clickhouse_tenant_id=tenant_id)
        user = User.objects.create(username=username)
        Membership.objects.create(user=user, organization=org, role="admin")
    User.objects.create(username="mallory")


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial"), ("auth", "0012_alter_user_first_name_max_length")]
    operations = [migrations.RunPython(create_demo_users, migrations.RunPython.noop)]
