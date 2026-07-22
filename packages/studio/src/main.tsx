import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { setGatewayBaseUrl } from './lib/api-client';
import { resolveStudioRuntimeConfig } from './lib/runtime-config';
import './styles/globals.css';

const runtimeConfig = resolveStudioRuntimeConfig({
  injected: window.__HYPEQUERY_STUDIO_CONFIG__,
  pathname: window.location.pathname,
});
setGatewayBaseUrl(runtimeConfig.gatewayBaseUrl);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Freshness is driven by SSE invalidation, not focus/interval refetches.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
