import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { App } from '../App';
import { parseDeployment, type Deployment, type Manifest } from '../config';
import { DeploymentContext } from '../deployment-context';
import { makeWagmiConfig } from '../wagmi';
import { createMockChain } from './mockChain';

const web = join(__dirname, '..', '..');
export function readInputs() {
  const handoff = JSON.parse(readFileSync(join(web, 'deployment/handoff.json'), 'utf8'));
  const net = JSON.parse(readFileSync(join(web, 'deployment/network.json'), 'utf8'));
  const abis: Record<string, unknown> = {};
  for (const c of handoff.contracts) abis[c.name] = JSON.parse(readFileSync(join(web, '..', 'docs/abi', `${c.name}.json`), 'utf8'));
  const manifest: Manifest = {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c: { name: string; address: `0x${string}`; abiHash: string }) => ({
      name: c.name,
      address: c.address,
      abiHash: c.abiHash,
      abiPath: `abi/${c.name}.json`,
    })),
    assets: [],
    poolKey: handoff.poolKey,
    network: net.network,
    walletAddChain: net.walletAddChain,
  };
  return { handoff, net, abis, manifest };
}

export function setup(opts: { mobile?: boolean } = {}) {
  const { manifest, abis } = readInputs();
  const d: Deployment = parseDeployment(manifest, abis);
  const chain = createMockChain(d);
  globalThis.fetch = chain.fetchStub as typeof fetch;
  (window as unknown as { ethereum: unknown }).ethereum = chain.provider;
  const wagmi = makeWagmiConfig(d, { pollingInterval: 50 });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = render(
    <DeploymentContext.Provider value={d}>
      <WagmiProvider config={wagmi} reconnectOnMount={false}>
        <QueryClientProvider client={qc}>
          <App mobile={opts.mobile ?? false} />
        </QueryClientProvider>
      </WagmiProvider>
    </DeploymentContext.Provider>,
  );
  return { d, chain, ui };
}
