import { createConfig, fallback, http } from 'wagmi';
import { coinbaseWallet, injected } from 'wagmi/connectors';
import { SITE_NAME, type Deployment } from './config';

/** wagmi config built from the runtime manifest: EIP-6963 browser wallets, then Coinbase Wallet. */
export function makeWagmiConfig(d: Deployment, opts: { pollingInterval?: number } = {}) {
  return createConfig({
    pollingInterval: opts.pollingInterval,
    chains: [d.chain],
    multiInjectedProviderDiscovery: true,
    connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
    transports: { [d.chain.id]: fallback(d.network.rpcUrls.map((u) => http(u))) },
  });
}
