import { useDeployment } from '../deployment-context';
import type { TxState } from '../tx';

const lead: Record<string, string> = {
  checking: 'Checking with the contract…',
  wallet: 'Confirm in your wallet…',
  pending: 'Submitted. Waiting for the receipt…',
  confirmed: 'Confirmed.',
  reverted: 'Reverted.',
  failed: 'Not sent.',
};

/** A stable polite live region that reports each phase, ending with what the receipt shows. */
export function TxStatus({ state, id }: { state: TxState; id: string }) {
  const d = useDeployment();
  const tone = state.phase === 'confirmed' ? 'ok' : state.phase === 'failed' || state.phase === 'reverted' ? 'bad' : 'info';
  return (
    <div className={`tx tx-${tone}`} role="status" id={id} data-phase={state.phase}>
      {state.phase !== 'idle' && (
        <>
          <p>
            <strong>{lead[state.phase]}</strong> {state.message ?? state.label}
          </p>
          {state.hash && (
            <a href={`${d.explorer}/tx/${state.hash}`} target="_blank" rel="noreferrer">
              View transaction on the explorer
            </a>
          )}
        </>
      )}
    </div>
  );
}
