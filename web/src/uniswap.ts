/**
 * Uniswap v4 helpers. Addresses always come from manifest.network.uniswapV4; only the ABI
 * fragments of that public infrastructure live here.
 */
import { encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from 'viem';
import type { PoolKey } from './config';

export const quoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

export const routerAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);
export const permit2Abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);
export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);
export const erc20Abi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
]);

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const;

export const poolId = (k: PoolKey): Hex =>
  keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks],
    ),
  );

/** V4_SWAP command byte and SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL actions. */
export const V4_SWAP_COMMAND = '0x10' as const;
export const EXACT_IN_ACTIONS = '0x060c0f' as const;

/** Build execute(commands, inputs, deadline) arguments for one exact-input single-pool swap. */
export function buildSwap(opts: {
  key: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  deadline: bigint;
  extended?: boolean;
}): { commands: Hex; inputs: Hex[]; deadline: bigint } {
  const { key, zeroForOne, amountIn, amountOutMinimum } = opts;
  const keyValue = { ...key, fee: key.fee, tickSpacing: key.tickSpacing };
  const swapParams = opts.extended
    ? encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
              { name: 'zeroForOne', type: 'bool' },
              { name: 'amountIn', type: 'uint128' },
              { name: 'amountOutMinimum', type: 'uint128' },
              { name: 'minHopPriceX36', type: 'uint256' },
              { name: 'hookData', type: 'bytes' },
            ],
          },
        ],
        [{ poolKey: keyValue, zeroForOne, amountIn, amountOutMinimum, minHopPriceX36: 0n, hookData: '0x' }],
      )
    : encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [
              { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
              { name: 'zeroForOne', type: 'bool' },
              { name: 'amountIn', type: 'uint128' },
              { name: 'amountOutMinimum', type: 'uint128' },
              { name: 'hookData', type: 'bytes' },
            ],
          },
        ],
        [{ poolKey: keyValue, zeroForOne, amountIn, amountOutMinimum, hookData: '0x' }],
      );
  const inCur: Address = zeroForOne ? key.currency0 : key.currency1;
  const outCur: Address = zeroForOne ? key.currency1 : key.currency0;
  const settle = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inCur, amountIn]);
  const take = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [outCur, amountOutMinimum]);
  const input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [EXACT_IN_ACTIONS, [swapParams, settle, take]]);
  return { commands: V4_SWAP_COMMAND, inputs: [input], deadline: opts.deadline };
}

/** Price of currency0 in currency1 units (both 18 decimals here) from sqrtPriceX96. */
export function priceFromSqrt(sqrtPriceX96: bigint): number {
  const r = Number(sqrtPriceX96) / 2 ** 96;
  return r * r;
}
