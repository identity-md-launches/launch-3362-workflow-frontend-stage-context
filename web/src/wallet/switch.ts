import { numberToHex } from 'viem';
import type { Deployment } from '../config';

type Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

const unknownChain = (e: unknown) => {
  const err = e as { code?: number; message?: string; data?: { originalError?: { code?: number } }; cause?: { code?: number } };
  return (
    err?.code === 4902 ||
    err?.data?.originalError?.code === 4902 ||
    err?.cause?.code === 4902 ||
    /unrecognized chain|unknown chain|not been added|chain .*not (found|supported|added)|4902/i.test(err?.message ?? '')
  );
};

/**
 * wallet_switchEthereumChain to the manifest chain; when the wallet does not know it, offer
 * wallet_addEthereumChain with the manifest's walletAddChain parameters, then switch again.
 */
export async function switchToDeploymentChain(provider: Provider, d: Deployment): Promise<'switched' | 'added'> {
  const chainId = numberToHex(d.chain.id);
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    return 'switched';
  } catch (e) {
    if (!unknownChain(e)) throw e;
    const add = d.manifest.walletAddChain ?? {
      chainId,
      chainName: d.network.name,
      rpcUrls: d.network.rpcUrls,
      nativeCurrency: d.network.nativeCurrency,
      blockExplorerUrls: [d.network.explorer],
    };
    await provider.request({ method: 'wallet_addEthereumChain', params: [add] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
    return 'added';
  }
}
