---
'@hypequery/serve': patch
---

Dataset and metric endpoints now enforce the related dataset's own policy. Previously a query on one served dataset could read fields of a related dataset through a relationship, such as `shipment.carrier` on `orders`, even when the caller failed that dataset's own endpoint's `requiredRoles`, `requiredScopes` or auth requirement. Such a query now answers `403 FORBIDDEN` before it is planned. Related datasets that are not served as their own entry are unaffected, so existing APIs keep working unless they relied on reading a protected dataset through another one.
