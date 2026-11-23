import { useId, useRef, useState, type FormEvent } from 'react';
import { useAccount, useConfig } from 'wagmi';
import { readContract, simulateContract } from 'wagmi/actions';
import { parseEventLogs, type Address, type TransactionReceipt } from 'viem';
import { useDeployment } from '../deployment-context';
import { fmt, parseAmount, pct } from '../format';
import { useCodeCheck, useProtocol, useUser } from '../hooks';
import { useTx } from '../tx';
import { TxStatus } from './TxStatus';

type Mode = 'stake' | 'withdraw';

export function StakePanel() {
  const d = useDeployment();
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const p = useProtocol();
  const u = useUser(address);
  const code = useCodeCheck();
  const tx = useTx();
  const cp = useTx();
  const [mode, setMode] = useState<Mode>('stake');
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const sym = p.symbol;

  const parsed = parseAmount(input, p.decimals);
  const available = mode === 'stake' ? u.balance : u.stake;
  let error = parsed.error;
  if (!error && parsed.value !== undefined && available !== undefined && parsed.value > available)
    error =
      mode === 'stake'
        ? `Your wallet holds ${fmt(available)} ${sym}. Enter that much or less.`
        : `You have ${fmt(available)} ${sym} staked. Enter that much or less.`;
  if (!error && mode === 'stake' && parsed.value !== undefined && p.maxTotal !== undefined && p.totalStaked !== undefined && parsed.value > p.maxTotal - p.totalStaked)
    error = `The contract accepts at most ${fmt(p.maxTotal - p.totalStaked)} more ${sym}.`;
  if (!error && submitted && parsed.value === undefined) error = `Enter an amount to ${mode}.`;
  const showError = !!error && (submitted || !!input);

  const right = isConnected && chainId === d.chain.id;
  const ready = right && code.data === true;
  const needsApproval = mode === 'stake' && parsed.value !== undefined && u.stakingAllowance !== undefined && u.stakingAllowance < parsed.value;
  const amountText = parsed.value !== undefined ? `${fmt(parsed.value, p.decimals, 6)} ${sym}` : sym;

  let label: string;
  if (!isConnected) label = `Connect a wallet to ${mode}`;
  else if (!right) label = 'Wrong network';
  else if (code.isLoading) label = 'Checking the contracts…';
  else if (code.data !== true) label = `Contracts not found on ${d.network.name}`;
  else if (tx.busy) label = `${tx.state.label}…`;
  else if (needsApproval) label = `Approve ${amountText}`;
  else label = `${mode === 'stake' ? 'Stake' : 'Withdraw'} ${amountText}`;

  const reread = async (fn: string, args: unknown[]) =>
    (await readContract(config, { address: d.staking.address, abi: d.staking.abi, functionName: fn, args } as never)) as bigint;

  const describeStakeChange = async (r: TransactionReceipt, event: 'Staked' | 'Withdrawn') => {
    const logs = parseEventLogs({ abi: d.staking.abi, logs: r.logs, eventName: event }) as unknown as {
      address: Address;
      args: { account: Address; amount: bigint };
    }[];
    const mine = logs.find((l) => l.address.toLowerCase() === d.staking.address.toLowerCase() && l.args.account.toLowerCase() === address!.toLowerCase());
    const now = await reread('stakes', [address]);
    if (!mine) return `The transaction succeeded, but its receipt has no ${event} event, so your stake did not change. Your stake is ${fmt(now)} ${sym}.`;
    return `The receipt shows ${event === 'Staked' ? 'Staked' : 'Withdrawn'} ${fmt(mine.args.amount, p.decimals, 6)} ${sym}. Your stake is now ${fmt(now)} ${sym}.`;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!ready || tx.busy) return;
    if (error || parsed.value === undefined) {
      inputRef.current?.focus();
      return;
    }
    const amount = parsed.value;
    if (needsApproval) {
      await tx.run({
        label: `Approving ${amountText}`,
        prepare: () =>
          simulateContract(config, {
            account: address,
            address: d.token.address,
            abi: d.token.abi,
            functionName: 'approve',
            args: [d.staking.address, amount],
          } as never),
        describe: async (r) => {
          const logs = parseEventLogs({ abi: d.token.abi, logs: r.logs, eventName: 'Approval' }) as unknown as {
            args: { owner: Address; spender: Address; value: bigint };
          }[];
          const ev = logs.find((l) => l.args.spender.toLowerCase() === d.staking.address.toLowerCase());
          const allowance = (await readContract(config, {
            address: d.token.address,
            abi: d.token.abi,
            functionName: 'allowance',
            args: [address, d.staking.address],
          } as never)) as bigint;
          return ev
            ? `The receipt shows an approval of ${fmt(ev.args.value, p.decimals, 6)} ${sym} for the staking contract. Next: stake.`
            : `The receipt has no Approval event. The staking contract may move ${fmt(allowance)} ${sym}.`;
        },
      });
      return;
    }
    const ok = await tx.run({
      label: `${mode === 'stake' ? 'Staking' : 'Withdrawing'} ${amountText}`,
      prepare: () =>
        simulateContract(config, {
          account: address,
          address: d.staking.address,
          abi: d.staking.abi,
          functionName: mode,
          args: [amount],
        } as never),
      describe: (r) => describeStakeChange(r, mode === 'stake' ? 'Staked' : 'Withdrawn'),
    });
    if (ok) {
      setInput('');
      setSubmitted(false);
    }
  };

  const onCheckpoint = () =>
    cp.run({
      label: 'Saving your points',
      prepare: () =>
        simulateContract(config, { account: address, address: d.staking.address, abi: d.staking.abi, functionName: 'checkpoint' } as never),
      describe: (r) => {
        const logs = parseEventLogs({ abi: d.staking.abi, logs: r.logs, eventName: 'PointsCheckpointed' }) as unknown as {
          args: { account: Address; earnedPoints: bigint };
        }[];
        const ev = logs.find((l) => l.args.account.toLowerCase() === address!.toLowerCase());
        return ev ? `The receipt shows ${fmt(ev.args.earnedPoints, 18, 2)} points saved to your account.` : 'The receipt has no checkpoint event.';
      },
    });

  const rate =
    u.stake !== undefined && p.totalStaked && p.pointsPerSecond !== undefined && p.totalStaked > 0n
      ? (p.pointsPerSecond * u.stake) / p.totalStaked
      : 0n;
  const dash = (v: string) => (isConnected ? v : '–');

  return (
    <section className="card stake" aria-labelledby="stake-title">
      <h2 id="stake-title" className="sr-only">
        Your staking
      </h2>
      <dl className="stats">
        <div>
          <dt>Wallet</dt>
          <dd className="num">{dash(`${fmt(u.balance)} ${sym}`)}</dd>
        </div>
        <div>
          <dt>Staked</dt>
          <dd className="num">{dash(`${fmt(u.stake)} ${sym}`)}</dd>
        </div>
        <div>
          <dt>Share</dt>
          <dd className="num">{dash(u.stake !== undefined && p.totalStaked !== undefined ? pct(u.stake, p.totalStaked) : '…')}</dd>
        </div>
        <div>
          <dt>Points</dt>
          <dd className="num">{dash(fmt(u.points, 18, 2))}</dd>
        </div>
      </dl>
      <p className="meta num">
        Total staked: {fmt(p.totalStaked)} {sym} · Points per second, shared: {fmt(p.pointsPerSecond, 18, 2)}
        {isConnected && u.stake ? ` · Yours per second: ${fmt(rate, 18, 4)}` : ''}
      </p>
      {p.isError && <p className="error">Unable to read the staking contract from the public RPC. Retrying every 12 seconds.</p>}
      {p.pointsPerSecond === 0n && <p className="meta">The owner has paused points emission. Stakes still withdraw normally.</p>}

      <form onSubmit={onSubmit} noValidate>
        <fieldset className="seg">
          <legend className="sr-only">Action</legend>
          {(['stake', 'withdraw'] as const).map((m) => (
            <label key={m} className="seg-opt">
              <input
                type="radio"
                name={`${uid}-mode`}
                value={m}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  setSubmitted(false);
                  tx.reset();
                }}
              />
              <span>{m === 'stake' ? 'Stake' : 'Withdraw'}</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <div className="field-top">
            <label htmlFor={`${uid}-amt`}>Amount to {mode}</label>
            {isConnected && (
              <span className="hint num">
                Available: {fmt(available)} {sym}
              </span>
            )}
          </div>
          <div className="amount">
            <input
              ref={inputRef}
              id={`${uid}-amt`}
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.0"
              value={input}
              aria-invalid={showError || undefined}
              aria-describedby={showError ? `${uid}-err` : undefined}
              onChange={(e) => setInput(e.target.value.replace(',', '.'))}
            />
            <span className="unit">{sym}</span>
            <button
              type="button"
              className="btn btn-quiet"
              disabled={!available}
              onClick={() => available !== undefined && setInput(fmt(available, p.decimals, 18).replace(/,/g, ''))}
            >
              Max
            </button>
          </div>
          {showError && (
            <p className="error" id={`${uid}-err`}>
              {error}
            </p>
          )}
        </div>
        {mode === 'stake' && needsApproval && !tx.busy && (
          <p className="meta">Step 1 of 2: allow the staking contract to move this amount of {sym}. Then stake it.</p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={!ready || tx.busy}>
          {label}
        </button>
        <TxStatus state={tx.state} id={`${uid}-tx`} />
      </form>
      {ready && !!u.stake && (
        <div className="checkpoint">
          <p className="meta">Points save automatically when you stake or withdraw.</p>
          <button type="button" className="btn btn-quiet" onClick={onCheckpoint} disabled={cp.busy}>
            {cp.busy ? 'Saving points…' : 'Save points now'}
          </button>
          <TxStatus state={cp.state} id={`${uid}-cp`} />
        </div>
      )}
    </section>
  );
}
