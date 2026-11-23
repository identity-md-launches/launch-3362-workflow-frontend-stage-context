# DESIGN.md: Test staking website

Extracted from the final source (`web/src/styles.css`, `web/src/**/*.tsx`) and checked against the
rendered export at 320, 390 and 1440 wide. This file belongs at the repository root by the brief;
the assignment's write scope (`web/**`, `dist/**`, `docs/**`) puts it in the frontend project root.

## Overview

A one-page tool for TEST holders on Sepolia: stake, withdraw, watch points, trade. The visual
character is quiet and paper-like: warm off-white page, white cards with hairline borders, near-black
text, one deep green for everything you can act on. The product comes first: on a phone the
headline, one plain sentence, then the staking card with its action, all on the first screen.
Density is moderate (16px card padding, 12px gaps inside a card, 16px between cards). Reference
facts (addresses, pool key, source commit) sit lower in one "Contracts and pool" card.

## Colors

Defined as hex primitives at the top of `web/src/styles.css` (`:root`) and consumed only through
semantic roles:

| Role token | Value | Use |
| --- | --- | --- |
| `--color-bg` | `--stone-50` `#f7f6f2` | page background, quiet hover fill, segmented-control track, idle status box |
| `--color-surface` | `#ffffff` | cards, inputs, menu, sheet, selected segment |
| `--color-border` | `--stone-200` `#e2dfd6` | card borders, separators |
| `--color-border-strong` | `--stone-300` `#cfcbbf` | input and secondary-button borders |
| `--color-text` | `--stone-900` `#1c1b18` | body and headings |
| `--color-text-secondary` | `--stone-600` `#5c584f` | labels, meta lines, hints |
| `--color-accent` | `--green-700` `#1d5c47` | primary button fill, links |
| `--color-accent-hover` / `-pressed` | `#164a39` / `#103829` | primary hover / pressed |
| `--color-accent-subtle` | `--green-50` `#e9f2ed` | confirmed transaction box |
| `--color-on-accent` | `#ffffff` | text on primary fill |
| `--color-danger` | `--red-700` `#a3301c` | field errors, failed or reverted transaction lead |
| `--color-focus` | `--stone-900` | 2px focus ring |

Green means "interactive" only. Status is never color alone: errors and transaction phases are
always written out ("Reverted.", "Confirmed."). Text contrast was measured by the taste probe on the
rendered page (all pairs pass 4.5:1 or 3:1 large); see `docs/FRONTEND.md`.

## Typography

- Families: `--font-sans` = `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`
  for everything; `--font-mono` = `ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`
  only for addresses and hashes (`.mono`). No web fonts are downloaded.
- Scale (`--text-*`): `sm` 13px (labels, meta, hints, mono data), `base` 15px (body, buttons), `input`
  16px (inputs and select, avoids iOS zoom), `lg` 20px (h2, stat values), `xl` 30px (h1).
- Weights: 400 body, 600 labels, buttons, h2 and stat values, 700 only for the h1.
- Line height 1.5 for body, 1.1 for the h1 (letter-spacing -0.02em, `text-wrap: balance`), 1.2 for h2.
- Numbers that change (`.num`) use `font-variant-numeric: tabular-nums`. The lede is capped at 60ch,
  the footer at 70ch.

## Layout

- Page container `.page`: max 1080px (`--page-max`), 16px inline padding, single grid column
  `minmax(0, 1fr)` with 16px gaps. Header `.top` uses the same width and padding, so the brand and the
  wallet control align with the cards' edges.
- Spacing steps `--space-1..6`: 4, 8, 12, 16, 24, 32px. Within a group 4 to 8px, between groups 12 to 16px.
- `.grid` holds the staking and trade cards: one column below 56rem, two equal `minmax(0, 1fr)`
  columns from 56rem.
- `.facts` (definition list): label above value on phones; from 40rem a 9rem label column beside the value.
- `.stats`: always two columns of `minmax(0, 1fr)`.
- Overflow rules: long addresses and hashes wrap with `overflow-wrap: anywhere`; inputs carry
  `width: 0; flex: 1` so a field never widens its card; fieldsets reset `min-inline-size`. Nothing is
  truncated with an ellipsis.
- The hero keeps 32px above the headline so the header's wallet button stays visibly separate.

## Elevation & Depth

Mostly flat. Cards use a 1px `--color-border` and no shadow. Two floating layers use a shadow and no
border: the account menu (`.menu`, `0 0 0 1px rgb(0 0 0 / .08), 0 8px 24px rgb(0 0 0 / .12)`) and the
selected segment (a 1px ring plus 1px drop). The connect sheet sits on a 40% black backdrop
(`.sheet-bg`, z-index 40); the menu is z-index 20; the skip link 30.

## Shapes

`--radius-sm` 8px (buttons, menu items, sheet rows, status box), `--radius-md` 12px (amount field,
segmented track, menu), `--radius-lg` 16px (cards, sheet top corners). Controls are at least 44px tall
(`--control-h`); the amount field is 48px; sheet rows 48px; the quiet button 36px.

## Components

- **Button** (`.btn`, `web/src/styles.css`): secondary by default (white, strong border). `.btn-primary`
  is the filled green action, used once per card. `.btn-block` is full width and wraps its label.
  `.btn-quiet` is small (Max, Save points now). States: hover, pressed `scale: 0.96` (dropped under
  reduced motion), `:focus-visible` ring, disabled at 60% opacity. Transaction buttons show the step in
  their label ("Approve 5 TEST", then "Stake 5 TEST", "Staking 5 TEST…").
- **Wallet control** (`web/src/wallet/WalletControl.tsx`): "Connect" opens `ConnectSheet` (dialog,
  bottom sheet under 40rem, centered above; rows are EIP-6963 wallets by name and icon, then Coinbase
  Wallet; on phones "Open in" links first; × in the title line, Escape and the backdrop close it;
  focus returns to the trigger). On a wrong chain it becomes the single "Switch to Sepolia" control.
  When connected it shows the short address and opens a menu: full address, Copy address, View on
  explorer, Disconnect.
- **Segmented control** (`.seg`, `.seg-opt`): native radio inputs over styled spans; used for
  Stake/Withdraw and Buy/Sell. Arrow keys move between options natively.
- **Amount field** (`.field`, `.field-top`, `.amount`, `.unit`): visible label with an "Available" hint
  on the same line, decimal input, unit and optional Max button inside one bordered box. Errors render
  below as `.error` text, linked by `aria-describedby`, with the box border turning `--color-danger`.
- **Transaction status** (`TxStatus`, `web/src/panels/TxStatus.tsx`, `.tx`): a polite live region kept in
  the DOM. Phases: checking, wallet, submitted, confirmed (green box, receipt summary), reverted or not
  sent (red lead). It links the transaction on the explorer.
- **Stats** (`.stats` `dl`) and **facts** (`.facts` `dl`): label in 13px secondary text, value below or beside.
- **Card** (`.card`): the only container; never nested.

## Do's and Don'ts

- Do read every address, chain value and ABI from the runtime manifest through `useDeployment()`;
  never add a constant address to a component.
- Do use `.btn-primary` for the one action of a card; peers stay `.btn` or `.btn-quiet`.
- Do write button labels as verb plus amount, and report transaction results from the receipt in `TxStatus`.
- Do use semantic `--color-*` tokens only; add a role token rather than borrowing one by value.
- Don't add uppercase or tracked labels above headings, a second accent hue, or a font download.
- Don't truncate addresses; let them wrap.
- Don't add a second "Switch network" control; disabled actions say "Wrong network".

To add a page section: put a `<section className="card" aria-labelledby=…>` with an `h2` into the
`.page` grid in `web/src/App.tsx`, use `.facts` or `.stats` for data, a `.field` + `.amount` for input,
one `.btn-primary` for the action, and a `TxStatus` under it driven by `useTx()`.
