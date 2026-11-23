/**
 * A scripted chain for interaction tests: a JSON-RPC handler behind a stubbed fetch (the site's
 * public RPC transport) and an EIP-1193 wallet on window.ethereum. No real network or funds.
 */
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  keccak256,
  numberToHex,
  parseEther,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import type { Deployment } from '../config';
import { erc20Abi, permit2Abi, quoterAbi, routerAbi, stateViewAbi } from '../uniswap';

export const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address;
const BLOCK = 0x100;

type Sent = { to: Address; data: Hex; value?: Hex; hash: Hex; decoded: { functionName: string; args?: readonly unknown[] } };

export function createMockChain(d: Deployment) {
  const s = {
    walletChain: d.chain.id,
    knownChains: new Set<number>([d.chain.id]),
    connected: false,
    balance: parseEther('100'),
    allowance: 0n,
    stake: 0n,
    totalStaked: parseEther('1000'),
    points: parseEther('12.5'),
    pps: parseEther('1'),
    eth: parseEther('2'),
    permit2Allowance: 0n,
    router: { amount: 0n, expiration: 0 },
    quoteOut: parseEther('5'),
    receipt: 'normal' as 'normal' | 'reverted' | 'noevent',
    reject: false,
    simRevert: undefined as undefined | { abi: Abi; errorName: string; args?: unknown[] },
    sent: [] as Sent[],
    walletCalls: [] as { method: string; params?: unknown[] }[],
    receipts: new Map<Hex, unknown>(),
  };
  const uni = d.uniswap!;
  const lc = (a?: string) => (a ?? '').toLowerCase();
  const targets: [Address, Abi][] = [
    [d.token.address, d.token.abi],
    [d.staking.address, d.staking.abi],
    [uni.quoter, quoterAbi as unknown as Abi],
    [uni.permit2, permit2Abi as unknown as Abi],
    [uni.stateView, stateViewAbi as unknown as Abi],
    [uni.universalRouter, routerAbi as unknown as Abi],
  ];
  const abiFor = (to: string) => targets.find(([a]) => lc(a) === lc(to))?.[1];

  function readResult(to: string, data: Hex): Hex {
    const abi = abiFor(to);
    if (!abi) return '0x';
    const { functionName, args = [] } = decodeFunctionData({ abi, data });
    const isToken = lc(to) === lc(d.token.address);
    const isStaking = lc(to) === lc(d.staking.address);
    let result: unknown;
    if (isToken) {
      if (functionName === 'balanceOf') result = s.balance;
      else if (functionName === 'allowance') result = lc(args[1] as string) === lc(uni.permit2) ? s.permit2Allowance : s.allowance;
      else if (functionName === 'symbol') result = 'TEST';
      else if (functionName === 'decimals') result = 18;
      else if (functionName === 'approve' || functionName === 'transfer') result = true;
      else result = 0n;
    } else if (isStaking) {
      const map: Record<string, unknown> = {
        totalStaked: s.totalStaked,
        pointsPerSecond: s.pps,
        owner: '0x2222222222222222222222222222222222222222',
        pendingOwner: '0x0000000000000000000000000000000000000000',
        MAX_TOTAL_STAKED: parseEther('1000000000'),
        currentTotalPointsEmitted: parseEther('5000'),
        stakes: s.stake,
        pendingPoints: s.points,
      };
      if (functionName === 'stake' || functionName === 'withdraw') return '0x';
      if (functionName === 'checkpoint') result = s.points;
      else result = map[functionName] ?? 0n;
    } else if (lc(to) === lc(uni.quoter)) result = [s.quoteOut, 100000n];
    else if (lc(to) === lc(uni.permit2)) {
      if (functionName === 'approve') return '0x';
      result = [s.router.amount, s.router.expiration, 0];
    } else if (lc(to) === lc(uni.stateView)) {
      result = functionName === 'getSlot0' ? [79228162514264337593543950336n, 0, 0, 12500] : 123456789n;
    } else return '0x';
    return encodeFunctionResult({ abi, functionName, result } as never);
  }

  const log = (address: Address, abi: Abi, eventName: string, args: Record<string, unknown>, data: Hex, i: number, hash: Hex) => ({
    address,
    topics: encodeEventTopics({ abi, eventName, args } as never),
    data,
    blockNumber: toHex(BLOCK),
    blockHash: keccak256('0xb1'),
    transactionHash: hash,
    transactionIndex: '0x0',
    logIndex: toHex(i),
    removed: false,
  });

  function mine(tx: { to: Address; data: Hex; value?: Hex }): Hex {
    const hash = keccak256(toHex(`tx${s.sent.length}${Date.now()}`));
    const abi = abiFor(tx.to)!;
    const decoded = decodeFunctionData({ abi, data: tx.data });
    s.sent.push({ ...tx, hash, decoded });
    const u = (v: bigint) => encodeAbiParameters([{ type: 'uint256' }], [v]);
    const logs: unknown[] = [];
    const args = decoded.args ?? [];
    if (s.receipt === 'normal') {
      if (lc(tx.to) === lc(d.token.address) && decoded.functionName === 'approve') {
        const [spender, value] = args as [Address, bigint];
        if (lc(spender) === lc(uni.permit2)) s.permit2Allowance = value;
        else s.allowance = value;
        logs.push(log(d.token.address, erc20Abi as unknown as Abi, 'Approval', { owner: ACCOUNT, spender }, u(value), 0, hash));
      } else if (lc(tx.to) === lc(d.staking.address) && decoded.functionName === 'stake') {
        const amount = args[0] as bigint;
        s.stake += amount;
        s.balance -= amount;
        s.allowance -= amount;
        s.totalStaked += amount;
        logs.push(log(d.staking.address, d.staking.abi, 'Staked', { account: ACCOUNT }, u(amount), 0, hash));
      } else if (lc(tx.to) === lc(d.staking.address) && decoded.functionName === 'withdraw') {
        const amount = args[0] as bigint;
        s.stake -= amount;
        s.balance += amount;
        s.totalStaked -= amount;
        logs.push(log(d.staking.address, d.staking.abi, 'Withdrawn', { account: ACCOUNT }, u(amount), 0, hash));
      } else if (lc(tx.to) === lc(uni.permit2) && decoded.functionName === 'approve') {
        s.router = { amount: args[2] as bigint, expiration: Number(args[3]) };
      } else if (lc(tx.to) === lc(uni.universalRouter)) {
        if (tx.value && BigInt(tx.value) > 0n) {
          s.balance += s.quoteOut;
          logs.push(log(d.token.address, erc20Abi as unknown as Abi, 'Transfer', { from: uni.poolManager, to: ACCOUNT }, u(s.quoteOut), 0, hash));
        }
      }
    }
    s.receipts.set(hash, {
      transactionHash: hash,
      transactionIndex: '0x0',
      blockHash: keccak256('0xb1'),
      blockNumber: toHex(BLOCK),
      from: ACCOUNT,
      to: tx.to,
      cumulativeGasUsed: '0x5208',
      gasUsed: '0x5208',
      effectiveGasPrice: '0x1',
      contractAddress: null,
      logs,
      logsBloom: `0x${'0'.repeat(512)}`,
      status: s.receipt === 'reverted' ? '0x0' : '0x1',
      type: '0x2',
    });
    return hash;
  }

  function rpc(method: string, params: unknown[] = []): unknown {
    switch (method) {
      case 'eth_chainId':
        return numberToHex(d.chain.id);
      case 'eth_blockNumber':
        return toHex(BLOCK);
      case 'eth_getCode':
        return '0x6080604052';
      case 'eth_getBalance':
        return toHex(s.eth);
      case 'eth_estimateGas':
        return '0x5208';
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        return '0x1';
      case 'eth_getTransactionCount':
        return '0x0';
      case 'eth_getBlockByNumber':
        return { number: toHex(BLOCK), hash: keccak256('0xb1'), baseFeePerGas: '0x1', timestamp: toHex(1_800_000_000), transactions: [] };
      case 'eth_getTransactionReceipt':
        return s.receipts.get(params[0] as Hex) ?? null;
      case 'eth_call': {
        const call = params[0] as { to: Address; data: Hex };
        if (s.simRevert) {
          const data = encodeErrorResult({ abi: s.simRevert.abi, errorName: s.simRevert.errorName, args: s.simRevert.args } as never);
          throw Object.assign(new Error('execution reverted'), { rpc: { code: 3, message: 'execution reverted', data } });
        }
        return readResult(call.to, call.data);
      }
      default:
        throw Object.assign(new Error(`unsupported ${method}`), { rpc: { code: -32601, message: `unsupported ${method}` } });
    }
  }

  const fetchStub = async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const one = (req: { id: number; method: string; params?: unknown[] }) => {
      try {
        return { jsonrpc: '2.0', id: req.id, result: rpc(req.method, req.params) };
      } catch (e) {
        return { jsonrpc: '2.0', id: req.id, error: (e as { rpc: unknown }).rpc };
      }
    };
    const out = Array.isArray(body) ? body.map(one) : one(body);
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  const emit = (ev: string, ...a: unknown[]) => listeners.get(ev)?.forEach((f) => f(...a));
  const provider = {
    isMetaMask: false,
    on: (ev: string, f: (...a: unknown[]) => void) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(f);
    },
    removeListener: (ev: string, f: (...a: unknown[]) => void) => listeners.get(ev)?.delete(f),
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      s.walletCalls.push({ method, params });
      switch (method) {
        case 'eth_requestAccounts':
          s.connected = true;
          return [ACCOUNT];
        case 'eth_accounts':
          return s.connected ? [ACCOUNT] : [];
        case 'eth_chainId':
          return numberToHex(s.walletChain);
        case 'wallet_requestPermissions':
        case 'wallet_getPermissions':
          return [{ parentCapability: 'eth_accounts' }];
        case 'wallet_revokePermissions':
          s.connected = false;
          return null;
        case 'wallet_switchEthereumChain': {
          const id = Number((params?.[0] as { chainId: Hex }).chainId);
          if (!s.knownChains.has(id)) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
          s.walletChain = id;
          emit('chainChanged', numberToHex(id));
          return null;
        }
        case 'wallet_addEthereumChain':
          s.knownChains.add(Number((params?.[0] as { chainId: Hex }).chainId));
          return null;
        case 'eth_sendTransaction': {
          if (s.reject) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          const tx = params?.[0] as { to: Address; data: Hex; value?: Hex };
          return mine(tx);
        }
        default:
          return rpc(method, params);
      }
    },
  };
  return { state: s, fetchStub, provider };
}
