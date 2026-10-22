---
'@hypequery/serve': patch
'@hypequery/datasets': patch
---

Dataset and metric endpoints now enforce the related dataset's own policy. Previously a query on one served dataset could read fields of a related dataset through a relationship, such as `shipment.carrier` on `orders`, even when the caller failed that dataset's own endpoint's `requiredRoles`, `requiredScopes` or auth requirement. Such a query now answers `403 FORBIDDEN` before it is planned. The check covers measures whose fixed filters read a related field, directly or through a derived measure, including the measures an omitted `measures` list selects. A related dataset with no local auth setting inherits the API's global auth, as its own endpoint does, and policies are matched to the related dataset definition itself rather than to any dataset sharing its name. Related datasets that are not served as their own entry are unaffected, so existing APIs keep working unless they relied on reading a protected dataset through another one.
