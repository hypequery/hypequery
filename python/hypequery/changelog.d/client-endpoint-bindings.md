- Add opt-in `client_profile` bindings for Python dataset/metric endpoints and
  router/application client-contract export using resolved FastAPI paths.
  Enforce the advertised strict query profile, clamp against actual policy,
  client and production ceilings, and check `X-Hypequery-Client-Schema` only
  after authorization. Reject stale pins with a safe HTTP 409. Legacy endpoints
  retain their input behavior and are omitted from client exports. Add trusted
  `client_mount_path` configuration and the matching default CORS allow-header.
