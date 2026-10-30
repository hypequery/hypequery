---
'@hypequery/cli': patch
---

`generate:client` names the output path it refuses, and why: the symbolic link or non-directory ancestor it found, with the same path written without the link (for example `/tmp` → `/private/tmp` on macOS). An ancestor that is a file is now reported as such, not as a bare `ENOTDIR`.
