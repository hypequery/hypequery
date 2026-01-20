async function fetchJson(path: string) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

export default async function Page() {
  const [revenue, activeUsers] = await Promise.all([
    fetchJson("/api/hypequery/metrics/weekly"),
    fetchJson("/api/hypequery/metrics/active-users"),
  ]);

  return (
    <main>
      <section>
        <h1>Next.js + hypequery Serve</h1>
        <p>
          This page calls the auto-generated API routes exposed through <code>@hypequery/serve</code>
          , running entirely inside a Next.js Route Handler.
        </p>
      </section>

      <section>
        <h2>Weekly Revenue</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Total ($)</th>
            </tr>
          </thead>
          <tbody>
            {revenue.map((row: { week: string; total: number }) => (
              <tr key={row.week}>
                <td>{row.week}</td>
                <td>{row.total.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Active Users</h2>
        <p style={{ fontSize: "2.5rem", margin: 0 }}>{activeUsers.count.toLocaleString()}</p>
      </section>
    </main>
  );
}
