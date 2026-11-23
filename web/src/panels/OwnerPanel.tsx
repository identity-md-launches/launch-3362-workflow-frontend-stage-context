import { useId, useState, type FormEvent } from 'react';
import { useAccount, useConfig } from 'wagmi';
import { readContract, simulateContract } from 'wagmi/actions';
import { parseEventLogs } from 'viem';
import { useDeployment } from '../deployment-context';
import { fmt, parseAmount } from '../format';
import { useCodeCheck, useProtocol } from '../hooks';
import { useTx } from '../tx';
import { TxStatus } from './TxStatus';

/** Shown only to the connected owner (rate) or pending owner (accept ownership). */
export function OwnerPanel() {
  const d = useDeployment();
  const config = useConfig();
  const { address, chainId } = useAccount();
  const p = useProtocol();
  const code = useCodeCheck();
  const tx = useTx();
  const uid = useId();
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const me = address?.toLowerCase();
  const isOwner = !!me && p.owner?.toLowerCase() === me;
  const isPending = !!me && p.pendingOwner?.toLowerCase() === me;
  if (!isOwner && !isPending) return null;
  const ready = chainId === d.chain.id && code.data === true;
  const s = { address: d.staking.address, abi: d.staking.abi } as const;

  const parsed = input.trim() === '0' ? { value: 0n } : parseAmount(input, 18);
  const error = parsed.error ?? (submitted && parsed.value === undefined ? 'Enter a rate in points per second, for example 1.' : undefined);

  const onRate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!ready || parsed.value === undefined || parsed.error) return;
    const rate = parsed.value;
    await tx.run({
      label: `Setting the rate to ${fmt(rate, 18, 6)} points per second`,
      prepare: () => simulateContract(config, { ...s, account: address, functionName: 'setPointsPerSecond', args: [rate] } as never),
      describe: async (r) => {
        const ev = parseEventLogs({ abi: d.staking.abi, logs: r.logs, eventName: 'PointsRateUpdated' })[0] as unknown as
          | { args: { previousRate: bigint; newRate: bigint } }
          | undefined;
        const now = (await readContract(config, { ...s, functionName: 'pointsPerSecond' } as never)) as bigint;
        return ev
          ? `The receipt shows the rate changed from ${fmt(ev.args.previousRate, 18, 6)} to ${fmt(ev.args.newRate, 18, 6)} points per second.`
          : `The receipt has no rate event. The rate reads ${fmt(now, 18, 6)} points per second.`;
      },
    });
  };
  const onAccept = () =>
    tx.run({
      label: 'Accepting ownership',
      prepare: () => simulateContract(config, { ...s, account: address, functionName: 'acceptOwnership' } as never),
      describe: async () => {
        const owner = (await readContract(config, { ...s, functionName: 'owner' } as never)) as string;
        return owner.toLowerCase() === me ? 'The contract now reads you as its owner.' : `The contract owner reads ${owner}.`;
      },
    });

  return (
    <section className="card" aria-labelledby="owner-title">
      <h2 id="owner-title">Owner settings</h2>
      {isPending && (
        <>
          <p className="meta">This wallet was offered ownership of TestStaking.</p>
          <button className="btn btn-primary" onClick={onAccept} disabled={!ready || tx.busy}>
            Accept ownership
          </button>
        </>
      )}
      {isOwner && (
        <form onSubmit={onRate} noValidate>
          <div className="field">
            <div className="field-top">
              <label htmlFor={`${uid}-rate`}>Points per second, shared by all stakers</label>
              <span className="hint num">Now: {fmt(p.pointsPerSecond, 18, 6)}</span>
            </div>
            <div className="amount">
              <input
                id={`${uid}-rate`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="1"
                value={input}
                aria-invalid={!!error || undefined}
                aria-describedby={error ? `${uid}-rerr` : undefined}
                onChange={(e) => setInput(e.target.value)}
              />
              <span className="unit">per second</span>
            </div>
            {error && (
              <p className="error" id={`${uid}-rerr`}>
                {error}
              </p>
            )}
          </div>
          <p className="meta">Points earned so far are saved at the old rate before the new one applies. 0 pauses emission.</p>
          <button type="submit" className="btn btn-primary" disabled={!ready || tx.busy}>
            {tx.busy ? `${tx.state.label}…` : 'Update rate'}
          </button>
        </form>
      )}
      <TxStatus state={tx.state} id={`${uid}-tx`} />
    </section>
  );
}
