# Frontend validation: Test staking website

Worker report for the frontend stage. Source in `web/`, static export in `dist/`, runtime
configuration in `dist/imd-deployment.json`. This is the worker's own evidence, not an independent
certification. Publication (IPFS pinning, naming) happens after this assignment and is not claimed here.

## Scope and assumptions

- One page: header with wallet control; hero; staking card (balance, stake, share, points, stake /
  withdraw with approval, save points); trade card (buy / sell TEST in the v4 pool); owner settings
  (only for the connected owner or pending owner); contracts and pool facts; footer.
- Contracts bound from the handoff (chain 11155111, source commit `d706f89f307cb0f54ebff75c1db34f8db4c99bd4`,
  attestation `20126179…5b`): LaunchToken `0xc5485f4136ab7fd5d427442fa9658f9d93afd607`, TestStaking
  `0xba90e29755f7efde50796e92cf243a6471188c01`. ABI hashes verified at build (`web/scripts/manifest-lib.mjs`)
  and again in the browser before any contract is used (`web/src/config.ts`, `parseDeployment`).
- Pool key copied unchanged from the handoff: currency0 native ETH, currency1 TEST, fee 12500, tick
  spacing 60, hooks `0xa0602cb30558d5dd17415b6268a4feea3a0ca000`. All quotes, approvals and swaps use
  the `network.uniswapV4` addresses from `network.json` (Quoter, Universal Router, Permit2, StateView).
- Primary contract actions with a control: `approve` (TEST to TestStaking), `stake`, `withdraw`,
  `checkpoint` ("Save points now"), `setPointsPerSecond` and `acceptOwnership` (owner panel). Swaps:
  buy with ETH (value sent, nothing approved), sell TEST (TEST `approve(permit2)`, then
  `permit2.approve(TEST, universalRouter, amount, expiration)`, then `execute`), each its own step.
  `transferOwnership` and `renounceOwnership` are deliberately not offered on a public page.
- Every transaction is simulated against the public RPC first (revert reasons shown), then signed by
  the wallet; the outcome shown is read from the mined receipt's events (`Approval`, `Staked`,
  `Withdrawn`, `PointsCheckpointed`, `PointsRateUpdated`, TEST `Transfer`) plus a fresh state read,
  never from the simulation (`web/src/tx.ts:37`, `web/src/panels/StakePanel.tsx`). A reverted receipt
  is reported as reverted.
- Transaction controls stay disabled until a wallet is connected, it is on Sepolia, and both contracts
  have code on the configured RPC (`useCodeCheck` in `web/src/hooks.ts`).
- No gas limit is set by the page. TestStaking has no `gasleft()` or fixed-gas forwarding path, so the
  wallet-estimate concern does not apply.
- USD context: no on-chain price source exists for TEST besides its own pool, so the page shows token
  units and the live pool price in ETH, and no USD value.
- `DESIGN.md` is at `web/DESIGN.md`. The brief asks for the repository root, but this assignment may
  only write `web/**`, `dist/**` and `docs/**`, so the frontend project root holds it.

## Verification (commands actually run, final source)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `cd web && npm run typecheck` | exit 0 |
| Unit and interaction tests | `cd web && npx vitest run` | 2 files, 15 tests passed |
| Production build | `cd web && npm run build` | exit 0; `imd-deployment.json: 11 assets, 1406554 bytes` |
| Manifest check | `src/test/manifest.test.ts` (after build) | keys exact; launchId, sourceCommit, attestationHash, poolKey, network, walletAddChain equal the inputs; contract addresses and abiHash equal the handoff; ABI canonical hashes recomputed; every asset SHA-256 recomputed and matching |
| Design probe | `node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16/16 checks passed (see below) |
| Browser check | `node web/scripts/browser-check.mjs "$PWD/dist" test/scratch/e2e` (Chromium 159 headless, export served under `/preview/`) | no console errors, no failed requests (see below) |

Export: 12 files, 1.4 MB, largest file 584 KB (far below 8 MiB per file and the 32 MiB half-budget).

### Interaction tests (`web/src/test/app.test.tsx`, mocked wallet and RPC)

1. Disconnected: headline, live total stake from the RPC, stake button disabled ("Connect a wallet to stake").
2. Connect sheet lists "Browser wallet" (never "Injected") and Coinbase Wallet; phone mode shows the
   "Open in MetaMask" link and "Coinbase Smart Wallet"; Escape closes it.
3. Connected reads: wallet balance 100 TEST, points 12.5, share 0%.
4. Amount validation: over-balance message beside the field with `aria-invalid`, empty-submit message, nothing sent.
5. Approve then stake: the approve call goes to the token for exactly 5 TEST to TestStaking; the stake
   call is `stake(5e18)`; the page reports "The receipt shows Staked 5 TEST. Your stake is now 5 TEST."
   and links the transaction on sepolia.etherscan.io.
6. Receipt beats simulation: simulation succeeds, receipt status 0, page says it reverted and nothing changed.
7. A successful receipt without a `Staked` event: page says the stake did not change.
8. Wallet rejection (4001) and a simulation revert (`StakeLimitExceeded`, decoded to a plain sentence); nothing sent.
9. Withdraw 3 of 8 TEST: reports the `Withdrawn` event and the new stake.
10. Wrong network: wallet on chain 1 without Sepolia; the header shows one "Switch to Sepolia"
    control, the action buttons read "Wrong network" and stay disabled; clicking sends
    `wallet_switchEthereumChain` → (4902) `wallet_addEthereumChain` with params deep-equal to
    `walletAddChain` → `wallet_switchEthereumChain`.
11. Buy: quote from the network Quoter shown; the transaction goes to the network Universal Router with
    `value = 0.1 ETH`, commands `0x10`, actions `0x060c0f`, the handoff's hooks address, `zeroForOne = true`,
    and `amountOutMinimum = quote × 99%`.
12. Sell: step 1 approves Permit2 for the exact amount; step 2 calls Permit2 `approve` for the Universal Router.

### Browser check on the production export (Chromium, real public Sepolia RPCs)

- 320, 390, 1440 wide: `scrollWidth - innerWidth = 0` on the page, with the connect sheet open, and
  with the account menu open at 320.
- First screen: the stake button's bottom edge is at 625px of an 844px viewport at 320 and 390 (558 of
  900 at 1440). The header holds the wallet control, and the card shows balance, stake, share, points,
  the stake/withdraw switch, the amount field and the action.
- Live reads rendered from Sepolia: "Total staked: 0 TEST · Points per second, shared: 1"; the pool
  price from StateView ("1 ETH = 50,000,000 TEST" at the time of the run); owner address; a live
  Quoter quote for 0.001 ETH ("You receive about 49,154.23827 TEST").
- Escape closes the sheet and focus returns to "Connect".
- Injected test wallet on chain 1: "Switch to Sepolia", then the calls were `wallet_switchEthereumChain`,
  `wallet_addEthereumChain` with the exact `walletAddChain` JSON, `wallet_switchEthereumChain`; after that
  the header showed the short address and the card read the account's live state (0 TEST, 0%, 0 points).
- Screenshots were inspected for 390 disconnected, 390 wrong chain, 320 sheet and 1440 (files in
  `test/scratch/`, which is not delivered).

### Design probe (taste@1), final export

render, layout, targets, contrast (all measured text meets 4.5:1 / 3:1 large), casing, tracking,
eyebrows, type-sizes (13, 15, 20 and 30px rendered, plus 16px in inputs), type-faces (system-ui and
ui-monospace; weights 400, 600, 700), glyphs, slogans, repetition, copy-budget (44 words of prose on
the first screen at 390), chrome, motion, share: all passed.

## Better Interface review

Coverage, by domain:

| Domain | Status | Evidence |
| --- | --- | --- |
| Accessibility | Checked | Native `button`, `a`, radio inputs for both segmented controls, `label for` on every input, `aria-invalid` and `aria-describedby` on field errors, one `h1`, skip link, `main` landmark, polite `role="status"` region per action that stays rendered, sheet is `role="dialog" aria-modal` with the page `inert`, Escape and focus return verified in Chromium, `:focus-visible` 2px ring, reduced motion drops the press scale. Not performed: a screen-reader session, native 200% zoom, forced-colors mode. |
| Layout | Checked | One column below 56rem, two cards side by side above; full addresses and hashes wrap (`overflow-wrap: anywhere`); no horizontal scroll at 320/390/1440 (measured). |
| Writing | Checked | Verb-first buttons that name the amount ("Approve 5 TEST", "Stake 5 TEST"); errors say how to fix, next to the field; sentence case throughout; no em dashes. |
| Typography | Checked | Five-step scale in `--text-*`, three weights, tabular numbers on balances and quotes, 16px inputs, `text-wrap: balance` on the headline. |
| Colors | Checked | Hex primitives with semantic `--color-*` roles; one accent (green) used only for interactive fills and links; contrast measured by the probe on rendered pairs. Not separately measured: focus ring against every adjacent color. |
| UI | Checked | Rest, hover, pressed (`scale: 0.96`), focus and disabled states on buttons and sheet rows; transitions name their properties (150ms); no border plus shadow on one surface. |

Findings and fixes (all rechecked on the final export):

| # | Severity | Domain | Location | Finding | Fix and recheck |
| --- | --- | --- | --- | --- | --- |
| 1 | High | Layout | `web/src/styles.css:420`, `:349`, `:275`, `:303` | At 320 the page was 360px wide: the amount input's intrinsic width and the fieldset's default `min-inline-size` forced the card past the screen, and the grids used `auto` tracks. | `width: 0` on the input, `min-inline-size: 0` on `.seg`, `minmax(0, 1fr)` tracks. Overflow measured 0 at 320/390/1440. |
| 2 | High | Accessibility | `web/src/wallet/WalletControl.tsx:117` | After Escape the focus fell to `body`: `focus()` ran while `#app-root` was still `inert`. | Focus moves back in an effect after the sheet unmounts. Chromium reports focus on "Connect". |
| 3 | Medium | Writing / layout | `web/src/panels/StakePanel.tsx:49`, `web/src/panels/TradePanel.tsx:105` | On the wrong network the disabled action buttons also said "Switch to Sepolia to stake", so the page looked like it had three switch controls. | They now read "Wrong network"; the header's "Switch to Sepolia" is the single control. |
| 4 | Medium | UI | `web/src/styles.css:281` | The probe read the header's filled "Connect" button as a kicker label within 40px above the headline. | 32px top padding on the hero. Probe eyebrows check passes; the main action stays on the first screen. |
| 5 | Medium | Writing | `web/src/panels/InfoPanel.tsx:63` | The pool line showed "liquidity 0" (in-range liquidity at the current tick) while the Quoter returned a real quote, which suggests the pool is empty. | Removed the raw figure; the live price and the live quote stay. |
| 6 | Low | Writing | `web/src/panels/StakePanel.tsx:170` | "1 points per second" pluralization. | Reworded to "Points per second, shared: 1". |
| 7 | Low | UI | `web/src/styles.css:411` | In the trade field the "ETH" unit touched the field's right edge. | Inline padding on both sides; tighter only when the Max button is present. |

## Not tested, and limitations

- No transaction was broadcast on Sepolia. Approve, stake, withdraw, checkpoint, owner settings, Permit2
  approvals and swaps were exercised against the mocked chain only. Their encoding (calldata, router
  commands, pool key) is asserted in tests, and the swap and quote addresses are the network table's.
  Live signing with MetaMask, Rabby, Coinbase Wallet or a phone wallet was not performed.
- A live `execute` simulation against the real router was not run, since it needs a funded account;
  the live Quoter call succeeded.
- The pool's initial price in the manifest (`sqrtPriceX96 = 2^96`) differs from the live StateView price
  the page shows (50,000,000 TEST per ETH at run time). The page reports the live value; this report
  does not judge the launch's pool configuration.
- WebKit/Safari, Firefox and physical devices were not tested; only headless Chromium.
- No screen-reader session, native browser zoom or forced-colors check.
- The Rabby "Open in" row is omitted: the pinned wallet reference gives no exact Rabby link format,
  and this report does not guess one. MetaMask, Coinbase Wallet and Phantom rows use their vendor-documented links.
- Coinbase Wallet / Smart Wallet connection was not exercised (needs the Coinbase popup).
- `og:image` is the relative `./og.png`; absolute Open Graph URLs wait for the published address.
- Publication checks (CID, named entrypoint, hosted asset hashes, RPC code checks) run after this
  assignment and are not claimed here.

Completion: complete for the stated scope, with the live-chain and cross-browser limitations above.
