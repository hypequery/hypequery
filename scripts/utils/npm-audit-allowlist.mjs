// Decides whether an `npm audit --json` report should fail CI, given an
// allowlist of advisories that have no fix yet. Policy: CONTRIBUTING.md
// ("Dependency advisories"). An allowlist entry excuses one advisory until its
// review date; after that date the advisory blocks again.

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

/** Extract the GHSA id from an advisory URL, e.g. ".../advisories/GHSA-xxxx-xxxx-xxxx". */
export function advisoryId(url) {
  const match = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(url ?? '');
  return match ? match[0].toUpperCase() : null;
}

/**
 * Every advisory npm reported directly against a package. Entries whose `via`
 * is only package names are transitive: they are vulnerable because of an
 * advisory listed on another entry, so the direct advisories cover them.
 */
export function directAdvisories(report) {
  const seen = new Map();
  for (const [name, entry] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const id = advisoryId(via.url) ?? `${via.name ?? name}:${via.source ?? via.title ?? 'unknown'}`;
      if (!seen.has(id)) {
        seen.set(id, { id, package: via.name ?? name, severity: via.severity, title: via.title, url: via.url });
      }
    }
  }
  return [...seen.values()];
}

/**
 * @param {object} report    parsed `npm audit --json` output
 * @param {Array<{id: string, package: string, reason: string, reviewBy: string}>} allowlist
 * @param {string} today     ISO date (YYYY-MM-DD)
 * @returns {{blocking: object[], allowed: object[], expired: object[]}}
 */
export function evaluateAudit(report, allowlist, today) {
  const byId = new Map(allowlist.map((entry) => [entry.id.toUpperCase(), entry]));
  const blocking = [];
  const allowed = [];
  const expired = [];

  for (const advisory of directAdvisories(report)) {
    if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue;
    const entry = byId.get(advisory.id);
    if (!entry || entry.package !== advisory.package) {
      blocking.push(advisory);
    } else if (today > entry.reviewBy) {
      expired.push({ ...advisory, reviewBy: entry.reviewBy });
    } else {
      allowed.push({ ...advisory, reviewBy: entry.reviewBy, reason: entry.reason });
    }
  }
  return { blocking, allowed, expired };
}
