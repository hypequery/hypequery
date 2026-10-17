- Add authenticated `add_client_contract_endpoint` discovery for installed strict
  client endpoints. Apply each target's role/scope/tenant policy before projection,
  sign the caller's authorized view, and return no-store responses that vary by
  credential transport. Keep metric-only/empty views valid, enforce a bounded
  response budget without truncation, and expose no tenant values or physical SQL.
