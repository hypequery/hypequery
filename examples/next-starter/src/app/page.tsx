'use client';

import { useQuery } from "@/lib/hypequery-client";


export default function Home() {

  const { data: helloData, isLoading: isLoadingHello } = useQuery('hello');
  const { data: statsData, isLoading: isLoadingStats } = useQuery('stats');

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>hypequery + Next.js Starter</h1>
      <p>Your hypequery API is running with React hooks!</p>

      <div style={{ marginTop: '2rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h3>GET /api/hypequery/hello</h3>
          {isLoadingHello ? (
            <p>Loading...</p>
          ) : (
            <pre style={preStyle}>
              {JSON.stringify(helloData, null, 2)}
            </pre>
          )}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <h3>GET /api/hypequery/stats</h3>
          {isLoadingStats ? (
            <p>Loading...</p>
          ) : (
            <pre style={preStyle}>
              {JSON.stringify(statsData, null, 2)}
            </pre>
          )}
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>Getting Started</h2>
        <p>Edit <code>src/queries.ts</code> to add your own queries.</p>
        <p>Data loads automatically using <code>@hypequery/react</code> hooks!</p>
      </div>
    </main>
  );
}

const preStyle = {
  background: '#f5f5f5',
  padding: '1rem',
  marginTop: '0.5rem',
  borderRadius: '4px',
  overflow: 'auto',
};
