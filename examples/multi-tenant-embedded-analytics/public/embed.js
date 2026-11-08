// The embed: get a token from *your* server, then talk to hypequery with it.
const fmt = new Intl.NumberFormat('en-US');
const pct = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 });
const RANGE = ['2026-10-02 00:00:00', '2026-10-31 23:59:59']; // the seed's last 30 days

async function token(email) {
  const res = await fetch('/api/analytics/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
  if (!res.ok) throw new Error(`token: ${res.status}`);
  return (await res.json()).token;
}

async function query(tok, body) {
  const res = await fetch('/api/analytics/datasets/events/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function tile(label, value) {
  return `<div class="card"><h2>${label}</h2><div class="value">${value}</div></div>`;
}

async function render(email) {
  const tok = await token(email);
  const filters = [{ field: 'occurredAt', operator: 'between', value: RANGE }];
  const kpis = await query(tok, { measures: ['events', 'uniqueUsers', 'errorRate', 'p95LatencyMs'], filters });
  const row = kpis.body.data?.[0] ?? {};
  document.getElementById('tiles').innerHTML =
    tile('Events', fmt.format(Number(row.events ?? 0))) +
    tile('Active users', fmt.format(Number(row.uniqueUsers ?? 0))) +
    tile('Error rate', pct.format(Number(row.errorRate ?? 0))) +
    tile('p95 latency', `${Math.round(Number(row.p95LatencyMs ?? 0))} ms`);

  const types = await query(tok, { dimensions: ['eventType'], measures: ['events'], filters, orderBy: [{ field: 'events', direction: 'desc' }] });
  const rows = types.body.data ?? [];
  const max = Math.max(1, ...rows.map((r) => Number(r.events)));
  document.getElementById('types').innerHTML = rows
    .map((r) => `<div class="row"><span>${r.eventType}</span><span class="track"><span class="fill" style="width:${(Number(r.events) / max) * 100}%"></span></span><span class="num">${fmt.format(Number(r.events))}</span></div>`)
    .join('');

  // Fail closed: the tenant is fixed by the token, so an explicit tenant filter is rejected.
  const forbidden = await query(tok, { measures: ['events'], filters: [{ field: 'tenantId', operator: 'eq', value: 1 }] });
  document.getElementById('forbidden').textContent = `HTTP ${forbidden.status}\n${JSON.stringify(forbidden.body, null, 2)}`;
}

(async () => {
  const users = await (await fetch('/api/demo-users')).json();
  const select = document.getElementById('user');
  select.innerHTML = users.map((u) => `<option value="${u.email}">${u.name} · ${u.tenantName}</option>`).join('');
  select.addEventListener('change', () => render(select.value));
  await render(users[0].email);
})().catch((e) => { document.getElementById('types').textContent = String(e); });
