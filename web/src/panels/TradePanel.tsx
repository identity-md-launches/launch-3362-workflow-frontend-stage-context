import { useEffect, useId, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useConfig, usePublicClient } from 'wagmi';
import { getBalance, simulateContract } from 'wagmi/actions';
import { parseEventLogs, zeroAddress, type Address } from 'viem';
import { useDeployment } from '../deployment-context';
import { explain } from '../errors';
import { fmt, parseAmount } from '../format';
import { useCodeCheck, useProtocol, useUser } from '../hooks';
import { useTx } from '../tx';
import { buildSwap, erc20Abi, permit2Abi, quoterAbi, routerAbi } from '../uniswap';
import { TxStatus } from './TxStatus';

type Side = 'buy' | 'sell';
const SLIPPAGES = [50, 100, 300] as const;
const PERMIT_DAYS = 30;

export function TradePanel() {
  const d = useDeployment();
  const key = d.poolKey;
  const uni = d.uniswap;
  if (!key || !uni)
    return (
      <section className="card" aria-labelledby="trade-title" id="trade">
        <h2 id="trade-title">Trade {'TEST'}</h2>
        <p className="meta">Trading is off: this chain has no vetted Uniswap v4 addresses or pool key in the deployment manifest.</p>
      </section>
    );
  return <Trade />;
}

function Trade() {
  const d = useDeployment();
  const key = d.poolKey!;
  const uni = d.uniswap!;
  const config = useConfig();
  const client = usePublicClient({ chainId: d.chain.id });
  const { address, isConnected, chainId } = useAccount();
  const p = useProtocol();
  const u = useUser(address);
  const code = useCodeCheck();
  const tx = useTx();
  const uid = useId();
  const [side, setSide] = useState<Side>('buy');
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');
  const [slip, setSlip] = useState<number>(100);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(input), 350);
    return () => clearTimeout(t);
  }, [input]);

  const sym = p.symbol;
  const tokenIsC1 = key.currency1.toLowerCase() === d.token.address.toLowerCase();
  const paired: Address = tokenIsC1 ? key.currency0 : key.currency1;
  const pairedNative = paired === zeroAddress;
  const pairedSym = pairedNative ? d.network.nativeCurrency.symbol : 'paired token';
  const zeroForOne = side === 'buy' ? tokenIsC1 : !tokenIsC1;
  const inSym = side === 'buy' ? pairedSym : sym;
  const outSym = side === 'buy' ? sym : pairedSym;
  const inputNative = side === 'buy' && pairedNative;

  const parsed = parseAmount(input, 18);
  const quoteAmount = parseAmount(debounced, 18).value;
  const quote = useQuery({
    queryKey: ['quote', uni.quoter, zeroForOne, quoteAmount?.toString()],
    enabled: !!client && quoteAmount !== undefined,
    retry: false,
    staleTime: 10_000,
    queryFn: async () => {
      const r = await client!.simulateContract({
        address: uni.quoter,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [{ poolKey: key, zeroForOne, exactAmount: quoteAmount!, hookData: '0x' }],
      });
      return r.result[0];
    },
  });
  const quoteFresh = quote.data !== undefined && debounced === input;
  const minOut = quoteFresh ? (quote.data! * BigInt(10_000 - slip)) / 10_000n : undefined;

  const available = side === 'buy' ? (pairedNative ? u.eth : undefined) : u.balance;
  let error = parsed.error;
  if (!error && parsed.value !== undefined && available !== undefined && parsed.value > available)
    error = `Your wallet holds ${fmt(available)} ${inSym}. Enter that much or less.`;
  if (!error && submitted && parsed.value === undefined) error = `Enter how much ${inSym} to ${side === 'buy' ? 'spend' : 'sell'}.`;
  const showError = !!error && (submitted || !!input);

  const now = Math.floor(Date.now() / 1000);
  const needTokenApproval = !inputNative && parsed.value !== undefined && u.permit2Allowance !== undefined && u.permit2Allowance < parsed.value;
  const needPermit =
    !inputNative &&
    parsed.value !== undefined &&
    u.routerAllowance !== undefined &&
    (u.routerAllowance.amount < parsed.value || u.routerAllowance.expiration < now + 300);
  const right = isConnected && chainId === d.chain.id;
  const ready = right && code.data === true;
  const amountText = parsed.value !== undefined ? `${fmt(parsed.value, 18, 6)} ${inSym}` : inSym;
  const inputToken: Address = side === 'buy' ? paired : d.token.address;

  let label: string;
  if (!isConnected) label = `Connect a wallet to ${side}`;
  else if (!right) label = 'Wrong network';
  else if (code.data !== true) label = code.isLoading ? 'Checking the contracts…' : `Contracts not found on ${d.network.name}`;
  else if (tx.busy) label = `${tx.state.label}…`;
  else if (needTokenApproval) label = `Approve ${inSym} for Permit2`;
  else if (needPermit) label = 'Allow the Uniswap router';
  else label = side === 'buy' ? `Buy ${sym} with ${amountText}` : `Sell ${amountText}`;
  const steps = inputNative ? 1 : 3;
  const step = needTokenApproval ? 1 : needPermit ? 2 : steps;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!ready || tx.busy || error || parsed.value === undefined) return;
    const amount = parsed.value;
    if (needTokenApproval) {
      await tx.run({
        label: `Approving ${inSym} for Permit2`,
        prepare: () =>
          simulateContract(config, { account: address, address: inputToken, abi: d.token.abi, functionName: 'approve', args: [uni.permit2, amount] } as never),
        describe: (r) => {
          const ev = (parseEventLogs({ abi: erc20Abi, logs: r.logs, eventName: 'Approval' }) as { args: { spender: Address; value: bigint } }[]).find(
            (l) => l.args.spender.toLowerCase() === uni.permit2.toLowerCase(),
          );
          return ev ? `The receipt shows Permit2 approved for ${fmt(ev.args.value, 18, 6)} ${inSym}. Next: allow the router.` : 'The receipt has no Approval event for Permit2.';
        },
      });
      return;
    }
    if (needPermit) {
      const expiration = now + PERMIT_DAYS * 86_400;
      await tx.run({
        label: 'Allowing the Uniswap router',
        prepare: () =>
          simulateContract(config, {
            account: address,
            address: uni.permit2,
            abi: permit2Abi,
            functionName: 'approve',
            args: [inputToken, uni.universalRouter, amount, expiration],
          }),
        describe: async () => {
          const r = (await client!.readContract({ address: uni.permit2, abi: permit2Abi, functionName: 'allowance', args: [address!, inputToken, uni.universalRouter] })) as readonly [
            bigint,
            number,
            number,
          ];
          return `Permit2 now lets the router spend ${fmt(r[0], 18, 6)} ${inSym} until ${new Date(Number(r[1]) * 1000).toLocaleDateString()}. Next: ${side}.`;
        },
      });
      return;
    }
    if (minOut === undefined) {
      setSubmitted(true);
      return;
    }
    const deadline = BigInt(now + 20 * 60);
    const swap = buildSwap({ key, zeroForOne, amountIn: amount, amountOutMinimum: minOut, deadline, extended: uni.extendedSwapParams === true });
    const before = side === 'sell' && pairedNative ? await getBalance(config, { address: address! }).then((b) => b.value).catch(() => undefined) : undefined;
    const ok = await tx.run({
      label: side === 'buy' ? `Buying ${sym}` : `Selling ${amountText}`,
      prepare: () =>
        simulateContract(config, {
          account: address,
          address: uni.universalRouter,
          abi: routerAbi,
          functionName: 'execute',
          args: [swap.commands, swap.inputs, swap.deadline],
          value: inputNative ? amount : 0n,
        }),
      describe: async (r) => {
        const transfers = parseEventLogs({ abi: erc20Abi, logs: r.logs, eventName: 'Transfer' }) as unknown as {
          address: Address;
          args: { from: Address; to: Address; value: bigint };
        }[];
        const me = address!.toLowerCase();
        const tokenLogs = transfers.filter((l) => l.address.toLowerCase() === d.token.address.toLowerCase());
        if (side === 'buy') {
          const got = tokenLogs.filter((l) => l.args.to.toLowerCase() === me).reduce((s, l) => s + l.args.value, 0n);
          return got > 0n
            ? `The receipt shows ${fmt(got, 18, 6)} ${sym} transferred to you for ${amountText}.`
            : `The transaction succeeded, but its receipt shows no ${sym} transferred to you.`;
        }
        const sent = tokenLogs.filter((l) => l.args.from.toLowerCase() === me).reduce((s, l) => s + l.args.value, 0n);
        const after = pairedNative ? await getBalance(config, { address: address! }).then((b) => b.value).catch(() => undefined) : undefined;
        const ethLine = after !== undefined ? ` Your ${pairedSym} balance is now ${fmt(after, 18, 6)}${before !== undefined ? ` (was ${fmt(before, 18, 6)} before gas and proceeds)` : ''}.` : '';
        return sent > 0n ? `The receipt shows ${fmt(sent, 18, 6)} ${sym} sent from your wallet.${ethLine}` : `The receipt shows no ${sym} leaving your wallet.${ethLine}`;
      },
    });
    if (ok) {
      setInput('');
      setSubmitted(false);
    }
  };

  return (
    <section className="card" aria-labelledby="trade-title" id="trade">
      <h2 id="trade-title">Trade {sym}</h2>
      <p className="meta">
        Swaps run in the {sym}/{pairedSym} Uniswap v4 pool through the Universal Router. Pool fee {(key.fee / 10_000).toLocaleString('en-US')}%.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <fieldset className="seg">
          <legend className="sr-only">Direction</legend>
          {(['buy', 'sell'] as const).map((s) => (
            <label key={s} className="seg-opt">
              <input
                type="radio"
                name={`${uid}-side`}
                value={s}
                checked={side === s}
                onChange={() => {
                  setSide(s);
                  setSubmitted(false);
                  tx.reset();
                }}
              />
              <span>{s === 'buy' ? `Buy ${sym}` : `Sell ${sym}`}</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <div className="field-top">
            <label htmlFor={`${uid}-amt`}>{side === 'buy' ? `${inSym} to spend` : `${sym} to sell`}</label>
            {isConnected && available !== undefined && (
              <span className="hint num">
                Available: {fmt(available)} {inSym}
              </span>
            )}
          </div>
          <div className="amount">
            <input
              id={`${uid}-amt`}
              name="swap-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={input}
              aria-invalid={showError || undefined}
              aria-describedby={`${showError ? `${uid}-err ` : ''}${uid}-quote`}
              onChange={(e) => setInput(e.target.value.replace(',', '.'))}
            />
            <span className="unit">{inSym}</span>
          </div>
          {showError && (
            <p className="error" id={`${uid}-err`}>
              {error}
            </p>
          )}
        </div>
        <div className="quote num" id={`${uid}-quote`} aria-live="polite">
          {parsed.value === undefined ? (
            <span className="meta">Enter an amount to get a quote from the Uniswap v4 quoter.</span>
          ) : quote.isFetching || !quoteFresh ? (
            quote.isError && debounced === input ? null : <span className="meta">Getting a quote…</span>
          ) : null}
          {quote.isError && debounced === input && parsed.value !== undefined && <span className="error">Unable to quote: {explain(quote.error)}</span>}
          {quoteFresh && parsed.value !== undefined && !quote.isError && (
            <>
              <span>
                You receive about <strong>{fmt(quote.data, 18, 6)} {outSym}</strong>
              </span>
              <span className="meta">
                At least {fmt(minOut, 18, 6)} {outSym} after {slip / 100}% slippage, or the swap reverts.
              </span>
            </>
          )}
        </div>
        <div className="field slip">
          <label htmlFor={`${uid}-slip`}>Slippage tolerance</label>
          <select id={`${uid}-slip`} value={slip} onChange={(e) => setSlip(Number(e.target.value))}>
            {SLIPPAGES.map((s) => (
              <option key={s} value={s}>
                {s / 100}%
              </option>
            ))}
          </select>
        </div>
        {ready && steps > 1 && parsed.value !== undefined && !tx.busy && (
          <p className="meta">
            Step {step} of {steps}: {step === 1 ? `let Permit2 hold an allowance for ${inSym}` : step === 2 ? 'let the Uniswap router spend it through Permit2' : `sell ${sym}`}.
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={!ready || tx.busy || (!needTokenApproval && !needPermit && parsed.value !== undefined && !quoteFresh)}>
          {label}
        </button>
        <TxStatus state={tx.state} id={`${uid}-tx`} />
      </form>
    </section>
  );
}
