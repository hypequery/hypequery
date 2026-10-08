- `ResultCache(on_error=...)` observes cache failures that would otherwise be silent.
  Failures still never fail a query. The hook receives the stage (`"key"`, `"get"` or
  `"put"`) and the exception; without it, failures are logged at debug level by
  exception type only. `ExecuteOptions` types the options tenant-bound clients
  forward, and `DEFAULT_PAGE_SIZE` names the default page size.
