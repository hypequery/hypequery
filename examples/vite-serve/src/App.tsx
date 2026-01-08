import { useEffect, useState } from "react";

type RevenueRow = {
  week: string;
  total: number;
};

type ActiveUsers = {
  count: number;
};

export default function App() {
  const [revenue, setRevenue] = useState<RevenueRow[]>([]);
  const [activeUsers, setActiveUsers] = useState<ActiveUsers | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [revenueRes, activeRes] = await Promise.all([
          fetch("/api/metrics/weekly").then((res) => res.json()),
          fetch("/api/metrics/active-users").then((res) => res.json()),
        ]);
        setRevenue(revenueRes);
        setActiveUsers(activeRes);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      }
    };

    load();
  }, []);

  return (
    <main>
      <h1>Vite + HypeQuery Serve</h1>
      <p>
        The API server runs on <code>localhost:4000</code> using <code>defineServe</code> while Vite proxies
        <code>/api</code> requests during development.
      </p>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Weekly Revenue</h2>
        <table>
          <thead>
            <tr>
              <th>Week</th>
              <th>Total ($)</th>
            </tr>
          </thead>
          <tbody>
            {revenue.map((row) => (
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
        <p className="stat">{activeUsers ? activeUsers.count.toLocaleString() : "--"}</p>
      </section>

      <section>
        <h2>Docs</h2>
        <p>
          Try the generated docs at <a href="/docs" target="_blank">/docs</a> or fetch the spec from
          <code>/openapi.json</code>.
        </p>
      </section>
    </main>
  );
}
