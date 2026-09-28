import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateProtocolSemanticQuery } from '../../../../packages/protocol/dist/index.js';
const dir = process.argv[2];
// RFC 8785 for this corpus: strings and safe integers only, keys sorted by UTF-16.
const jcs = (v) => Array.isArray(v) ? `[${v.map(jcs).join(',')}]`
  : v !== null && typeof v === 'object'
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${jcs(v[k])}`).join(',')}}`
    : JSON.stringify(v);
const enc = new TextEncoder();
const byBytes = (a, b) => Buffer.compare(Buffer.from(enc.encode(a)), Buffer.from(enc.encode(b)));
class Reject extends Error { constructor(code) { super(code); this.code = code; } }
function build(c) {
  const secret = Buffer.from(c.secretHex, 'hex');
  if (secret.length === 0) throw new Reject('HQ_CACHE_PREIMAGE_SECRET_MISSING');
  if (secret.length < 32) throw new Reject('HQ_CACHE_PREIMAGE_SECRET_TOO_SHORT');
  if (typeof c.definitionIdentity !== 'string' || !/^[0-9a-f]{64}$/.test(c.definitionIdentity)) throw new Reject('HQ_CACHE_PREIMAGE_INVALID_DEFINITION');
  try { validateProtocolSemanticQuery(c.query, { extension: 2 }); } catch { throw new Reject('HQ_CACHE_PREIMAGE_INVALID_QUERY'); }
  const q = c.query;
  const filters = [...new Map((q.filters ?? []).map((f) => [jcs(f), f])).entries()].sort((a, b) => byBytes(a[0], b[0])).map((e) => e[1]);
  const query = { kind: q.kind, dataset: q.dataset, dimensions: q.dimensions ?? [], filters,
    segments: [...(q.segments ?? [])].sort(byBytes), orderBy: q.orderBy ?? [], by: q.by ?? null, offset: q.offset || null };
  if (q.kind === 'metric') query.metric = q.metric; else query.measures = q.measures ?? null;
  const t = c.tenant, bad = new Reject('HQ_CACHE_PREIMAGE_INVALID_TENANT');
  let tenant;
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw bad;
  const keys = Object.keys(t).sort().join();
  if ((t.mode === 'none' || t.mode === 'all') && keys === 'mode') tenant = { mode: t.mode };
  else if (t.mode === 'scoped' && keys === 'ids,mode' && Array.isArray(t.ids) && t.ids.length >= 1
    && t.ids.every((i) => typeof i === 'string' && i.length > 0)) {
    const fp = (id) => createHmac('sha256', secret).update(Buffer.concat([Buffer.from('hypequery.tenant.fingerprint.v1\0'), Buffer.from(enc.encode(id))])).digest('hex');
    tenant = { mode: 'scoped', fingerprints: [...new Set(t.ids.map(fp))].sort() };
  }
  else throw bad;
  const l = c.rowLimit;
  if (!(l === null || (Number.isSafeInteger(l) && l >= 0))) throw new Reject('HQ_CACHE_PREIMAGE_INVALID_LIMIT');
  return jcs({ kind: 'hypequery-cache-preimage', version: 1, definition: c.definitionIdentity, query, tenant, rowLimit: l });
}
let ok = 0, bad = 0;
for (const c of JSON.parse(readFileSync(`${dir}/success.json`, 'utf8'))) {
  const got = build(c); if (got === c.preimageUtf8) ok++; else { bad++; console.log('MISMATCH', c.id, got); }
}
for (const c of JSON.parse(readFileSync(`${dir}/rejections.json`, 'utf8'))) {
  try { build(c); bad++; console.log('ACCEPTED', c.id); } catch (e) { if (e.code === c.error) ok++; else { bad++; console.log('CODE', c.id, e.code, c.error); } }
}
console.log(`${ok} agree, ${bad} disagree`);
process.exit(bad ? 1 : 0);
