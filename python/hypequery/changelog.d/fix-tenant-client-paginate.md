- `TenantDatasetClient.execute` and `AsyncTenantDatasetClient.execute` accept
  `paginate=True`, as the unbound clients do, so request handlers holding a
  tenant-bound client can fetch pages with `has_more` metadata.
