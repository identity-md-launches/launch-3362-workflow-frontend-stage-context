// Shared by the build (emit-manifest.mjs) and the dev server (vite.config.ts).
// Inputs: deployment/handoff.json and deployment/network.json (verbatim copies of the workflow
// handoff and the network's chain table) plus the implementation-derived ABIs in ../docs/abi.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toBytes } from 'viem';

export const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = join(webRoot, '..');

const sortKeys = (v) =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
      : v;

/** canonicalKeccak(abi): keccak256 of the key-sorted, whitespace-free JSON, as lowercase hex without 0x. */
export const canonicalAbiHash = (abi) => keccak256(toBytes(JSON.stringify(sortKeys(abi)))).slice(2);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function loadInputs() {
  const handoff = JSON.parse(readFileSync(join(webRoot, 'deployment/handoff.json'), 'utf8'));
  const net = JSON.parse(readFileSync(join(webRoot, 'deployment/network.json'), 'utf8'));
  if (net.network.chainId !== handoff.chainId) throw new Error('network.json chainId differs from the handoff');
  const abis = handoff.contracts.map((c) => {
    const bytes = readFileSync(join(repoRoot, 'docs/abi', `${c.name}.json`));
    const abi = JSON.parse(bytes.toString('utf8'));
    if (!Array.isArray(abi)) throw new Error(`${c.name} ABI is not an array`);
    const hash = canonicalAbiHash(abi);
    if (hash !== c.abiHash) throw new Error(`${c.name} ABI hash ${hash} does not match handoff ${c.abiHash}`);
    return { name: c.name, path: `abi/${c.name}.json`, bytes };
  });
  return { handoff, net, abis };
}

/** Build the manifest object; key order follows the required schema. */
export function buildManifest({ handoff, net, abis }, assets) {
  const m = {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c) => ({
      name: c.name,
      address: c.address,
      abiHash: c.abiHash,
      abiPath: abis.find((a) => a.name === c.name).path,
    })),
    assets,
  };
  if (handoff.poolKey) m.poolKey = handoff.poolKey;
  m.network = net.network;
  if (net.walletAddChain) m.walletAddChain = net.walletAddChain;
  return m;
}
