import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConfig } from 'wagmi';
import { getPublicClient, writeContract } from 'wagmi/actions';
import type { Hash, TransactionReceipt } from 'viem';
import { explain } from './errors';

export type TxPhase = 'idle' | 'checking' | 'wallet' | 'pending' | 'confirmed' | 'reverted' | 'failed';
export type TxState = { phase: TxPhase; label?: string; hash?: Hash; message?: string };

type Run = {
  /** Present tense label for the action, e.g. "Staking 5 TEST". */
  label: string;
  /** Simulate against the public RPC and return the request to sign. Its result is never reported. */
  prepare: () => Promise<{ request: unknown }>;
  /** Describe what the mined receipt (or state read after it) shows. */
  describe: (receipt: TransactionReceipt) => string | Promise<string>;
};

/** One transaction at a time: simulate, sign, wait for the receipt, report the receipt, refresh reads. */
export function useTx() {
  const config = useConfig();
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>({ phase: 'idle' });
  const busy = state.phase === 'checking' || state.phase === 'wallet' || state.phase === 'pending';

  const run = useCallback(
    async ({ label, prepare, describe }: Run) => {
      setState({ phase: 'checking', label });
      let hash: Hash | undefined;
      try {
        const { request } = await prepare();
        setState({ phase: 'wallet', label });
        hash = await writeContract(config, request as never);
        setState({ phase: 'pending', label, hash });
        // viem's receipt wait (not wagmi's wrapper, which throws on a revert) so the receipt's own status is reported.
        const receipt = await getPublicClient(config)!.waitForTransactionReceipt({ hash });
        await qc.invalidateQueries();
        if (receipt.status !== 'success') {
          setState({ phase: 'reverted', label, hash, message: 'The transaction was mined but reverted. Nothing changed on chain.' });
          return false;
        }
        setState({ phase: 'confirmed', label, hash, message: await describe(receipt) });
        return true;
      } catch (e) {
        setState({ phase: 'failed', label, hash, message: explain(e) });
        return false;
      }
    },
    [config, qc],
  );
  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, busy, run, reset };
}
