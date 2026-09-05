---
"@hypequery/cli": patch
---

Brand the `hypequery login` browser callback page. The loopback listener now
serves a self-contained page with distinct success and failure states, a status
chip, retry guidance, and light/dark support, still under the existing
`default-src 'none'` callback CSP.
