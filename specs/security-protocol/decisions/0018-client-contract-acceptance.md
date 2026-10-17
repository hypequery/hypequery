# RFC 0018 acceptance review — 15 October 2026

Status: accepted for the client-contract-v1 data format in PX-02. This is an
implementation review record; it does not represent external human sign-off,
a published Python beta, or completion of the HTTP/React/MCP integrations.

The review compared the proposed closed shapes, advertised query capabilities,
identity rules and both language implementations against all six RFC gates.

1. Export IDs and static paths remain independent. Dataset IDs equal their group;
   metric IDs differ and name one output alias. Metric-only views remain valid.
   No artifact route supplies an origin, tenant, credential or executable SQL.
   Prefixes are host configuration; dot/encoded/template/foreign routes fail.
2. Explicit field operators and numeric HAVING eligibility prevent inference from
   string result values. Related dimensions remain nullable; named aliases can
   filter without grouping. Defaults select only the ordered advertised base
   measures. Null input is rejected instead of defaulted; integer-valued JSON
   numbers follow binary64 semantics across languages. Result limits clamp while
   offsets reject. Legacy catalog compiler defaults remain unchanged.
3. Safe failures now have fixed messages and pinned paths. Both implementations
   reject duplicate text members, invalid Unicode, non-finite values and oversized
   inputs. Shared cases cover exact byte/depth/endpoint/descriptor boundaries;
   language suites cover hostile host values. JavaScript Proxy reflection cannot
   be made side-effect-free; the RFC states that limit explicitly. A forged or
   exotic exception from a reflection trap is sanitized to HQ_CLIENT_TYPE.
4. Fixed MCP query tools remain present with required never-valued routing fields
   when no target exists. Compiler tests prove they are uncallable, including a
   metric-only authorized view. Typed structural JSON schemas accompany a required
   runtime semantic check for dependent rules; JSON Schema alone is not sufficient.
5. Execution-time X-Hypequery-Client-Schema pinning closes the planned schema
   discovery/execution race when adapters implement it against the same request
   registration/policy snapshot. Auth and current policy precede comparison;
   mismatch is a fixed 409, with explicit reconnect rather than automatic retry.
   These adapter/bridge tests remain mandatory PX-03/PX-04/PX-07 release work.
6. Four canonical documents retain the independently verified draft bytes and
   both SHA-256 domains. The accepted family promotes the vectors, adds boundary
   and strict-query cases, and requires both adapters to announce it. Runner-side
   fixture composition sends complete inputs to either implementation; negative
   patches retain stale identities to prove shape validation precedes hashes.

The review identified host-dependent timezone aliases/casing as a portability gap.
The accepted profile therefore pins 597 timezone spellings in timezone-names.txt;
matching package registries are checked against that source. Runtime ICU/zoneinfo
acceptance does not determine contract identity or the strict acceptance language.

Evidence: the TypeScript reference and Python adapters pass shared client vectors,
including exact error paths/messages and normalized query output; existing protocol
and SQL portability families remain passing. The implementation PR records final
unit/type/quality counts and CI results. No deployment, bundle, release or invocation
artifact version changes.
