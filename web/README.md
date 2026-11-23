# Test staking website

The frontend for the Test (TEST) launch on Sepolia: stake TEST in `TestStaking`, earn points,
withdraw, and buy or sell TEST in its Uniswap v4 pool. Vite, React 18, TypeScript, wagmi 2 and viem 2.
The production export is committed at the repository root in `dist/` and runs from any static host,
an IPFS gateway subpath or an ENS name (relative `base: './'`, one page, no server routes).

## Configuration: one place

The app has no build-time address map. At startup `src/config.ts` fetches `./imd-deployment.json`
(next to `index.html`) and the ABI files it lists, verifies each ABI's canonical keccak hash against
the manifest, and builds the chain, wagmi transports and contract bindings from it. Everything below
comes from that one file:

| Value | Manifest field |
| --- | --- |
| Chain id, name, native currency, explorer, public RPCs (fallback order) | `chainId`, `network` |
| `LaunchToken` and `TestStaking` addresses and ABIs | `contracts[].address`, `contracts[].abiPath` |
| Pool key for quotes and swaps | `poolKey` |
| Uniswap v4 PoolManager, Universal Router, Quoter, StateView, Permit2 | `network.uniswapV4` |
| `wallet_addEthereumChain` parameters | `walletAddChain` |

The manifest is generated, never edited by hand. `scripts/emit-manifest.mjs` builds it after
`vite build` from two verbatim inputs and the pinned ABIs:

- `web/deployment/handoff.json`: the workflow deployment handoff (launch id, source commit
  `d706f89f`, attestation hash, both contract addresses and ABI hashes, pool key);
- `web/deployment/network.json`: the network's chain table for Sepolia (`network`, `walletAddChain`);
- `docs/abi/LaunchToken.json`, `docs/abi/TestStaking.json`: implementation-derived ABIs at the
  deployed source commit. The script refuses to build if either canonical hash differs from the handoff.

It copies the ABIs to `dist/abi/`, hashes every exported file (SHA-256) into `assets`, and writes
`dist/imd-deployment.json` with exactly the keys `version, launchId, chainId, sourceCommit,
attestationHash, contracts, assets, poolKey, network, walletAddChain`. There is no private RPC URL,
API key or WalletConnect project id anywhere. Wallets connect by EIP-6963 (every installed
extension by name), Coinbase Wallet / Smart Wallet, and on phones "Open in MetaMask / Coinbase
Wallet / Phantom" links. No relay is used.

## Install, preview, rebuild

```sh
cd web
npm ci                 # installs from package-lock.json
npm run dev            # dev server; serves the same manifest and ABIs from deployment/ + docs/abi
npm run typecheck      # tsc --noEmit
npm test               # vitest: interaction tests with a mocked wallet and RPC
npm run build          # tsc, vite build -> ../dist, then emit-manifest -> ../dist/imd-deployment.json
npm run preview        # serves ../dist locally
```

Always commit `dist/` together with `dist/imd-deployment.json` after a rebuild: the manifest's asset
hashes describe the exact bytes in `dist/`. `web/public/og.png` (the share image) and
`web/public/favicon.svg` are copied into the export as-is.

## Validation

- `npm test` runs `src/test/app.test.tsx` and `src/test/manifest.test.ts`. The interaction tests
  render the real app against `src/test/mockChain.ts`, a scripted JSON-RPC chain behind `fetch` plus
  an EIP-1193 wallet on `window.ethereum`. The manifest test checks `dist/imd-deployment.json`
  against the handoff and re-hashes every listed asset.
- `scripts/browser-check.mjs` drives the built export in Chromium (needs Playwright importable).
- The design probe: `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste`
  from the repository root.

Results, coverage and what was not tested on a live chain are in `docs/FRONTEND.md`. The design
system is documented in `web/DESIGN.md`.
