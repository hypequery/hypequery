---
"@hypequery/serve": patch
---

Node adapter (`createNodeHandler`) now works inside Express, NestJS and Fastify without workarounds:

- Routes on `req.originalUrl` when a framework sets it, so `app.use('/api/analytics', createNodeHandler(api.handler))` matches routes instead of returning 404. If you mounted under a prefix and set `basePath: ''` to compensate for the stripped URL, set `basePath` to the mount prefix instead.
- Uses a body that an upstream parser already read (`express.json()`, `express.text()`, `express.raw()`, NestJS's default parser) from `req.body` instead of failing with a 400 `VALIDATION_ERROR`. String and Buffer bodies still go through `bodyLimit` and content-type parsing. On Fastify, set `request.raw.body = request.body` before calling the handler, or hijack from an `onRequest` hook.
- If the body stream was consumed and no `req.body` is available, returns a 500 that explains how to fix the setup, instead of validating an empty body.
