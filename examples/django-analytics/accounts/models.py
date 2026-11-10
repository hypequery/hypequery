"""App data stays in Django's ORM. Each organization records the ClickHouse
tenant its analytics belong to; each user belongs to one organization."""

from django.conf import settings
from django.db import models


class Organization(models.Model):
    name = models.CharField(max_length=200)
    plan = models.CharField(max_length=20)
    # The tenant_id column in ClickHouse's events and subscriptions tables.
    clickhouse_tenant_id = models.PositiveIntegerField(unique=True)

    def __str__(self) -> str:
        return self.name


class Membership(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="membership")
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="members")
    role = models.CharField(max_length=20, default="member")
