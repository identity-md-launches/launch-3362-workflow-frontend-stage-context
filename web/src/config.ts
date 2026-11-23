/**
 * The single source of deployment configuration. Everything chain-specific (chain id, contract
 * addresses, ABIs, pool key, public RPCs, explorer, Uniswap v4 addresses, wallet_addEthereumChain
 * parameters) is read at runtime from ./imd-deployment.json, the manifest emitted beside this
 * bundle, and the ABI files it lists. Nothing here holds a second copy of those values.
 * No private RPC URL, API key or WalletConnect project id exists in this site.
 */
import { defineChain, getAddress, isAddress, keccak256, toBytes, type Abi, type Address, type Chain } from 'viem';

export const SITE_NAME = 'Test staking';
export const SITE_DESCRIPTION =
  'Stake Test (TEST) on Sepolia to earn points every second, and trade TEST in its Uniswap v4 pool.';
export const MANIFEST_PATH = './imd-deployment.json';

export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type NetworkBlock = {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets?: string[];
  uniswapV4?: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
    extendedSwapParams?: boolean;
  };
};
export type WalletAddChain = {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls?: string[];
};
export type Manifest = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; abiPath: string }[];
  assets: { path: string; sha256: string }[];
  poolKey?: PoolKey;
  network?: NetworkBlock;
  walletAddChain?: WalletAddChain;
};
export type Deployment = {
  manifest: Manifest;
  chain: Chain;
  network: NetworkBlock;
  token: { address: Address; abi: Abi };
  staking: { address: Address; abi: Abi };
  poolKey?: PoolKey;
  uniswap?: NonNullable<NetworkBlock['uniswapV4']>;
  explorer: string;
};

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
        )
      : v;
export const canonicalAbiHash = (abi: unknown) => keccak256(toBytes(JSON.stringify(sortKeys(abi)))).slice(2);

const safeRelative = (p: string) => !/^[a-z]+:|^\/|(^|\/)\.\.(\/|$)/i.test(p);

/** Validate the manifest shape and bind it to a viem chain. Throws a readable Error on any mismatch. */
export function parseDeployment(manifest: Manifest, abis: Record<string, unknown>): Deployment {
  if (manifest.version !== 1) throw new Error('Unsupported deployment manifest version.');
  const network = manifest.network;
  if (!network) throw new Error('The deployment manifest has no network block, so the chain is not vetted.');
  if (network.chainId !== manifest.chainId) throw new Error('Manifest chainId and network.chainId differ.');
  const bind = (name: string) => {
    const c = manifest.contracts.find((x) => x.name === name);
    if (!c || !isAddress(c.address)) throw new Error(`The manifest has no valid ${name} contract.`);
    if (!safeRelative(c.abiPath)) throw new Error(`${name} abiPath must be relative to the site.`);
    const abi = abis[name];
    if (!Array.isArray(abi)) throw new Error(`${name} ABI did not load as a JSON array.`);
    if (canonicalAbiHash(abi) !== c.abiHash) throw new Error(`${name} ABI does not match its attested hash.`);
    return { address: getAddress(c.address), abi: abi as Abi };
  };
  const chain = defineChain({
    id: network.chainId,
    name: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: { default: { http: network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: network.explorer } },
    testnet: network.testnet,
  });
  return {
    manifest,
    chain,
    network,
    token: bind('LaunchToken'),
    staking: bind('TestStaking'),
    poolKey: manifest.poolKey,
    uniswap: network.uniswapV4,
    explorer: network.explorer.replace(/\/$/, ''),
  };
}

/** Fetch ./imd-deployment.json and every ABI it references, relative to the page. */
export async function loadDeployment(fetcher: typeof fetch = fetch): Promise<Deployment> {
  const res = await fetcher(MANIFEST_PATH, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Unable to load ${MANIFEST_PATH} (HTTP ${res.status}).`);
  const manifest = (await res.json()) as Manifest;
  const abis: Record<string, unknown> = {};
  for (const c of manifest.contracts ?? []) {
    if (!safeRelative(c.abiPath)) throw new Error(`${c.name} abiPath must be relative to the site.`);
    const r = await fetcher(`./${c.abiPath}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Unable to load ${c.abiPath} (HTTP ${r.status}).`);
    abis[c.name] = await r.json();
  }
  return parseDeployment(manifest, abis);
}
