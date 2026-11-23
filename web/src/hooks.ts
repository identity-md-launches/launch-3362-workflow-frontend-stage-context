import { useQuery } from '@tanstack/react-query';
import { useBalance, usePublicClient, useReadContracts } from 'wagmi';
import type { Address } from 'viem';
import { useDeployment } from './deployment-context';
import { permit2Abi, poolId, stateViewAbi } from './uniswap';

export const POLL_MS = 12_000;

/** Contract-wide state, read from the public RPC whether or not a wallet is connected. */
export function useProtocol() {
  const d = useDeployment();
  const s = { address: d.staking.address, abi: d.staking.abi } as const;
  const t = { address: d.token.address, abi: d.token.abi } as const;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...s, functionName: 'totalStaked' },
      { ...s, functionName: 'pointsPerSecond' },
      { ...s, functionName: 'owner' },
      { ...s, functionName: 'pendingOwner' },
      { ...s, functionName: 'MAX_TOTAL_STAKED' },
      { ...t, functionName: 'symbol' },
      { ...t, functionName: 'decimals' },
      { ...s, functionName: 'currentTotalPointsEmitted' },
    ],
    query: { refetchInterval: POLL_MS },
  });
  const r = q.data;
  return {
    isLoading: q.isLoading,
    isError: q.isError || (r?.[0]?.status === 'failure' && r?.[1]?.status === 'failure'),
    totalStaked: r?.[0]?.result as bigint | undefined,
    pointsPerSecond: r?.[1]?.result as bigint | undefined,
    owner: r?.[2]?.result as Address | undefined,
    pendingOwner: r?.[3]?.result as Address | undefined,
    maxTotal: r?.[4]?.result as bigint | undefined,
    symbol: (r?.[5]?.result as string | undefined) ?? 'TEST',
    decimals: Number((r?.[6]?.result as number | bigint | undefined) ?? 18),
    totalEmitted: r?.[7]?.result as bigint | undefined,
  };
}

/** The connected account's balances, stake, points and allowances. */
export function useUser(account?: Address) {
  const d = useDeployment();
  const permit2 = d.uniswap?.permit2;
  const router = d.uniswap?.universalRouter;
  const s = { address: d.staking.address, abi: d.staking.abi } as const;
  const t = { address: d.token.address, abi: d.token.abi } as const;
  const a = account ?? '0x0000000000000000000000000000000000000000';
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...t, functionName: 'balanceOf', args: [a] },
      { ...t, functionName: 'allowance', args: [a, d.staking.address] },
      { ...s, functionName: 'stakes', args: [a] },
      { ...s, functionName: 'pendingPoints', args: [a] },
      ...(permit2 && router
        ? ([
            { ...t, functionName: 'allowance', args: [a, permit2] },
            { address: permit2, abi: permit2Abi, functionName: 'allowance', args: [a, d.token.address, router] },
          ] as const)
        : []),
    ] as never,
    query: { enabled: !!account, refetchInterval: POLL_MS },
  });
  const eth = useBalance({ address: account, query: { enabled: !!account, refetchInterval: POLL_MS } });
  const r = q.data as { status: string; result?: unknown }[] | undefined;
  const p2 = r?.[5]?.result as readonly [bigint, number, number] | undefined;
  return {
    isLoading: !!account && q.isLoading,
    balance: r?.[0]?.result as bigint | undefined,
    stakingAllowance: r?.[1]?.result as bigint | undefined,
    stake: r?.[2]?.result as bigint | undefined,
    points: r?.[3]?.result as bigint | undefined,
    permit2Allowance: r?.[4]?.result as bigint | undefined,
    routerAllowance: p2 ? { amount: p2[0], expiration: Number(p2[1]) } : undefined,
    eth: eth.data?.value,
  };
}

/** Live pool state from the network's StateView, for the handoff's pool key. */
export function usePool() {
  const d = useDeployment();
  const id = d.poolKey ? poolId(d.poolKey) : undefined;
  const sv = d.uniswap?.stateView;
  const q = useReadContracts({
    allowFailure: true,
    contracts: id && sv
      ? [
          { address: sv, abi: stateViewAbi, functionName: 'getSlot0', args: [id] },
          { address: sv, abi: stateViewAbi, functionName: 'getLiquidity', args: [id] },
        ]
      : [],
    query: { enabled: !!id && !!sv, refetchInterval: POLL_MS * 2 },
  });
  const slot0 = q.data?.[0]?.result as readonly [bigint, number, number, number] | undefined;
  return { id, sqrtPriceX96: slot0?.[0], tick: slot0?.[1], liquidity: q.data?.[1]?.result as bigint | undefined, isLoading: q.isLoading };
}

/** Both deployed contracts must have code on the configured chain before any transaction is offered. */
export function useCodeCheck() {
  const d = useDeployment();
  const client = usePublicClient({ chainId: d.chain.id });
  return useQuery({
    queryKey: ['code', d.token.address, d.staking.address],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        client!.getCode({ address: d.token.address }),
        client!.getCode({ address: d.staking.address }),
      ]);
      return !!a && a !== '0x' && !!b && b !== '0x';
    },
    enabled: !!client,
    staleTime: Infinity,
    retry: 2,
  });
}
