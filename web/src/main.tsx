import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { App } from './App';
import { loadDeployment, type Deployment } from './config';
import { DeploymentContext } from './deployment-context';
import { makeWagmiConfig } from './wagmi';
import './styles.css';

export function Root({ deployment, mobile }: { deployment: Deployment; mobile?: boolean }) {
  const wagmi = useMemo(() => makeWagmiConfig(deployment), [deployment]);
  const qc = useMemo(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }), []);
  return (
    <DeploymentContext.Provider value={deployment}>
      <WagmiProvider config={wagmi}>
        <QueryClientProvider client={qc}>
          <App mobile={mobile} />
        </QueryClientProvider>
      </WagmiProvider>
    </DeploymentContext.Provider>
  );
}

const el = document.getElementById('app-root');
if (el) {
  const root = createRoot(el);
  loadDeployment()
    .then((d) =>
      root.render(
        <StrictMode>
          <Root deployment={d} />
        </StrictMode>,
      ),
    )
    .catch((e: Error) => {
      root.render(
        <main className="page">
          <h1>Unable to load this site’s deployment</h1>
          <p className="error" role="alert">
            {e.message}
          </p>
          <p>Transactions stay off until imd-deployment.json and its ABIs load and match their attested hashes.</p>
        </main>,
      );
    });
}
