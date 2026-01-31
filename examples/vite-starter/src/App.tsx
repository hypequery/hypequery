import './App.css';
import { useQuery } from './lib/hypequery-client';

function App() {
  const { data: helloData, isLoading: isLoadingHello, error: helloError } = useQuery('hello');
  const { data: statsData, isLoading: isLoadingStats, error: statsError } = useQuery('stats');

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>hypequery + Vite Starter</h1>
      <p>Your hypequery API is running with React hooks!</p>

      <div style={{ marginTop: '2rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h3>GET /api/hello</h3>
          {isLoadingHello ? (
            <p>Loading...</p>
          ) : helloError ? (
            <div style={{ padding: '1rem', background: '#fee', borderRadius: '4px' }}>
              <strong>Error:</strong>
              <pre style={{ ...preStyle, background: 'transparent', marginTop: '0.5rem' }}>
                {JSON.stringify(helloError, null, 2)}
              </pre>
            </div>
          ) : (
            <pre style={preStyle}>
              {JSON.stringify(helloData, null, 2)}
            </pre>
          )}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <h3>GET /api/stats</h3>
          {isLoadingStats ? (
            <p>Loading...</p>
          ) : statsError ? (
            <div style={{ padding: '1rem', background: '#fee', borderRadius: '4px' }}>
              <strong>Error:</strong>
              <pre style={{ ...preStyle, background: 'transparent', marginTop: '0.5rem' }}>
                {JSON.stringify(statsError, null, 2)}
              </pre>
            </div>
          ) : (
            <pre style={preStyle}>
              {JSON.stringify(statsData, null, 2)}
            </pre>
          )}
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2>Getting Started</h2>
        <p>Edit <code>api/queries.ts</code> to add your own queries.</p>
        <p>Data loads automatically using <code>@hypequery/react</code> hooks!</p>
      </div>
    </div>
  );
}

const preStyle = {
  background: '#f5f5f5',
  padding: '1rem',
  marginTop: '0.5rem',
  borderRadius: '4px',
  overflow: 'auto',
};

export default App;
