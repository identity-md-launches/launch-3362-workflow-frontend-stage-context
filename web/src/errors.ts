import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from 'viem';
import { fmt } from './format';

const known: Record<string, (args: readonly unknown[]) => string> = {
  ZeroAmount: () => 'Enter an amount greater than 0.',
  StakeLimitExceeded: () => 'This amount would pass the contract’s total stake limit. Enter a smaller amount.',
  InsufficientStake: (a) => `You can withdraw at most ${fmt(a[0] as bigint)} TEST.`,
  RateTooHigh: (a) => `The rate can be at most ${fmt(a[1] as bigint)} points per second.`,
  UnexpectedTokenBalance: () => 'The staking contract received a different amount than requested, so it refused the stake.',
  TokenHasNoCode: () => 'The token contract has no code on this network.',
  OwnableUnauthorizedAccount: () => 'Only the contract owner can do this.',
  ERC20InsufficientBalance: () => 'Your TEST balance is too low for this amount.',
  ERC20InsufficientAllowance: () => 'Approve this amount first, then try again.',
};

/** Turn a wallet, RPC or contract error into one plain sentence. */
export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return 'You declined the request in your wallet. Nothing was sent.';
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (rev) {
      const name = rev.data?.errorName;
      if (name && known[name]) return known[name](rev.data?.args ?? []);
      if (name) return `The contract refused this: ${name}.`;
      if (rev.reason) return `The contract refused this: ${rev.reason}.`;
      return 'The contract refused this transaction in simulation.';
    }
    if (/insufficient funds/i.test(e.message)) return 'Your wallet does not have enough ETH to pay for gas.';
    return e.shortMessage || e.message;
  }
  const code = (e as { code?: number })?.code;
  if (code === 4001) return 'You declined the request in your wallet. Nothing was sent.';
  return e instanceof Error ? e.message : 'Unable to complete the request. Try again.';
}
