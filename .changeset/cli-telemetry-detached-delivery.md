---
"@hypequery/cli": patch
---

Deliver telemetry from a detached sender process instead of a 40 ms in-process request. The command exits without waiting on the network, while the sender gets up to five seconds, so batches survive TLS handshakes and serverless cold starts. The per-version kill switch (HTTP 410) is now applied by the sender.
