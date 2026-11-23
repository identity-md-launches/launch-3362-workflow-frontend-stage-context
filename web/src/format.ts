import { formatUnits, parseUnits } from 'viem';

/** Format a token amount with grouping and at most `maxFrac` fraction digits (truncated, never rounded up). */
export function fmt(value: bigint | undefined, decimals = 18, maxFrac = 4): string {
  if (value === undefined) return '…';
  const [int, frac = ''] = formatUnits(value, decimals).split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const f = frac.slice(0, maxFrac).replace(/0+$/, '');
  if (value !== 0n && grouped === '0' && !f) return `<0.${'0'.repeat(Math.max(0, maxFrac - 1))}1`;
  return `${neg ? '-' : ''}${grouped}${f ? '.' + f : ''}`;
}

export type Parsed = { value?: bigint; error?: string };

/** Parse a user amount. Returns an error phrased as an instruction. */
export function parseAmount(input: string, decimals = 18): Parsed {
  const s = input.trim();
  if (!s) return {};
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return { error: 'Enter a number, for example 10 or 0.5.' };
  const frac = s.split('.')[1] ?? '';
  if (frac.length > decimals) return { error: `Use at most ${decimals} decimal places.` };
  const value = parseUnits(s, decimals);
  if (value === 0n) return { error: 'Enter an amount greater than 0.' };
  return { value };
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const pct = (num: bigint, den: bigint) => {
  if (den === 0n) return '0%';
  const bp = Number((num * 1000000n) / den) / 10000;
  return `${bp.toLocaleString('en-US', { maximumFractionDigits: bp < 1 ? 4 : 2 })}%`;
};
