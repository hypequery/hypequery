- `create_api(client_profile=...)` puts every `Dataset` entry of `datasets=` in
  the client contract, so the shorthand can produce typed React hooks.
- A build export with no client endpoints now fails:
  `hypequery.serve.export_client_contract(api)` raises `ValueError` naming the
  dataset and metric routes installed without a client profile, and
  `hypequery export client-contract` exits 1.
- `hypequery export client-contract --factory` accepts the installed API (an
  `Api`, its `to_asgi_app` or `to_wsgi_app` application, or a zero-argument
  function returning one) and exports its build view, so the contract cannot
  drift from the served paths.
- Breaking: a `create_api(metrics={key: ...})` key is the metric's name, as in
  TypeScript: its client-contract ID, React hook key and output alias. A metric
  created with a different `name=` is refused.
