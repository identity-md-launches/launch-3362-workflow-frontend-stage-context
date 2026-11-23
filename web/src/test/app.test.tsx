import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { decodeAbiParameters, decodeFunctionData, parseEther, type Hex } from 'viem';
import { ACCOUNT } from './mockChain';
import { setup } from './helpers';
import { routerAbi } from '../uniswap';

const connect = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
  const dialog = await screen.findByRole('dialog', { name: 'Connect a wallet' });
  expect(within(dialog).queryByText(/Injected/)).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: /Browser wallet/ }));
  await screen.findByRole('button', { name: /0x1111…1111/ });
};
const stakeCard = () => document.querySelector('section.stake') as HTMLElement;
const tradeCard = () => document.getElementById('trade') as HTMLElement;

describe('disconnected visitor', () => {
  it('shows the product, live contract totals and a disabled action', async () => {
    setup();
    expect(screen.getByRole('heading', { level: 1, name: 'Stake TEST, earn points' })).toBeTruthy();
    await screen.findByText(/Total staked: 1,000 TEST/);
    const btn = within(stakeCard()).getByRole('button', { name: 'Connect a wallet to stake' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText('0xba90e29755f7efde50796e92cf243a6471188c01'.replace(/./g, (c) => c), { exact: false })).toBeTruthy();
  });

  it('lists the browser wallet and Coinbase Wallet; on a phone it offers Open in rows', async () => {
    setup({ mobile: true });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Open in MetaMask' }).getAttribute('href')).toMatch(/^https:\/\/link\.metamask\.io\/dapp\//);
    expect(within(dialog).getByRole('button', { name: /Coinbase Smart Wallet/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('connected staking', () => {
  it('reads balance, stake, share and points once connected', async () => {
    setup();
    await connect();
    const card = stakeCard();
    await within(card).findByText('100 TEST');
    expect(within(card).getByText('12.5')).toBeTruthy();
    expect(within(card).getByText('0%')).toBeTruthy();
  });

  it('validates the amount before anything is sent', async () => {
    const { chain } = setup();
    await connect();
    await within(stakeCard()).findByText('100 TEST');
    const input = within(stakeCard()).getByLabelText('Amount to stake');
    fireEvent.change(input, { target: { value: '1000' } });
    expect(await within(stakeCard()).findByText('Your wallet holds 100 TEST. Enter that much or less.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(within(stakeCard()).getByRole('button', { name: /^Stake/ }));
    expect(await within(stakeCard()).findByText('Enter an amount to stake.')).toBeTruthy();
    expect(chain.state.sent).toHaveLength(0);
  });

  it('approves, then stakes, reporting each receipt', async () => {
    const { chain, d } = setup();
    await connect();
    await within(stakeCard()).findByText('100 TEST');
    fireEvent.change(within(stakeCard()).getByLabelText('Amount to stake'), { target: { value: '5' } });
    fireEvent.click(await within(stakeCard()).findByRole('button', { name: 'Approve 5 TEST' }));
    await within(stakeCard()).findByText(/The receipt shows an approval of 5 TEST for the staking contract/);
    expect(chain.state.sent[0].to.toLowerCase()).toBe(d.token.address.toLowerCase());
    expect(chain.state.sent[0].decoded).toMatchObject({ functionName: 'approve', args: [d.staking.address, parseEther('5')] });

    fireEvent.click(await within(stakeCard()).findByRole('button', { name: 'Stake 5 TEST' }));
    await within(stakeCard()).findByText(/The receipt shows Staked 5 TEST\. Your stake is now 5 TEST\./);
    expect(chain.state.sent[1].decoded).toMatchObject({ functionName: 'stake', args: [parseEther('5')] });
    expect(within(stakeCard()).getByRole('link', { name: 'View transaction on the explorer' }).getAttribute('href')).toBe(
      `https://sepolia.etherscan.io/tx/${chain.state.sent[1].hash}`,
    );
  });

  it('reports a reverted receipt, not the successful simulation', async () => {
    const { chain } = setup();
    chain.state.allowance = parseEther('50');
    chain.state.receipt = 'reverted';
    await connect();
    await within(stakeCard()).findByText('100 TEST');
    fireEvent.change(within(stakeCard()).getByLabelText('Amount to stake'), { target: { value: '5' } });
    fireEvent.click(await within(stakeCard()).findByRole('button', { name: 'Stake 5 TEST' }));
    await within(stakeCard()).findByText(/mined but reverted\. Nothing changed on chain\./);
    expect(chain.state.stake).toBe(0n);
  });

  it('says so when a successful receipt carries no Staked event', async () => {
    const { chain } = setup();
    chain.state.allowance = parseEther('50');
    chain.state.receipt = 'noevent';
    await connect();
    await within(stakeCard()).findByText('100 TEST');
    fireEvent.change(within(stakeCard()).getByLabelText('Amount to stake'), { target: { value: '5' } });
    fireEvent.click(await within(stakeCard()).findByRole('button', { name: 'Stake 5 TEST' }));
    await within(stakeCard()).findByText(/its receipt has no Staked event, so your stake did not change/);
  });

  it('handles a wallet rejection and a contract revert in simulation', async () => {
    const { chain, d } = setup();
    chain.state.allowance = parseEther('50');
    chain.state.reject = true;
    await connect();
    await within(stakeCard()).findByText('100 TEST');
    fireEvent.change(within(stakeCard()).getByLabelText('Amount to stake'), { target: { value: '5' } });
    fireEvent.click(await within(stakeCard()).findByRole('button', { name: 'Stake 5 TEST' }));
    await within(stakeCard()).findByText('You declined the request in your wallet. Nothing was sent.');

    chain.state.reject = false;
    chain.state.simRevert = { abi: d.staking.abi, errorName: 'StakeLimitExceeded' };
    fireEvent.click(within(stakeCard()).getByRole('button', { name: 'Stake 5 TEST' }));
    await within(stakeCard()).findByText(/would pass the contract’s total stake limit/);
    expect(chain.state.sent).toHaveLength(0);
  });

  it('withdraws and reports the Withdrawn event', async () => {
    const { chain } = setup();
    chain.state.stake = parseEther('8');
    await connect();
    await within(stakeCard()).findByText('8 TEST');
    fireEvent.click(within(stakeCard()).getByLabelText('Withdraw'));
    fireEvent.change(within(stakeCard()).getByLabelText('Amount to withdraw'), { target: { value: '3' } });
    fireEvent.click(await within(stakeCard()).findByRole('button', { name: 'Withdraw 3 TEST' }));
    await within(stakeCard()).findByText(/The receipt shows Withdrawn 3 TEST\. Your stake is now 5 TEST\./);
  });
});

describe('network enforcement', () => {
  it('switches, and adds the chain with walletAddChain when the wallet does not know it', async () => {
    const { chain, d } = setup();
    chain.state.walletChain = 1;
    chain.state.knownChains = new Set([1]);
    await (async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Browser wallet/ }));
    })();
    const sw = await screen.findByRole('button', { name: 'Switch to Sepolia' });
    expect((within(stakeCard()).getByRole('button', { name: 'Wrong network' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sw);
    await screen.findByRole('button', { name: /0x1111…1111/ });
    const calls = chain.state.walletCalls.filter((c) => c.method.startsWith('wallet_') && c.method !== 'wallet_requestPermissions');
    expect(calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    expect(calls[1].params?.[0]).toEqual(d.manifest.walletAddChain);
  });
});

describe('trading through the network Uniswap v4 addresses', () => {
  it('quotes with the quoter and buys through the universal router with ETH value', async () => {
    const { chain, d } = setup();
    await connect();
    const card = tradeCard();
    fireEvent.change(within(card).getByLabelText('ETH to spend'), { target: { value: '0.1' } });
    await within(card).findByText('5 TEST');
    fireEvent.click(await within(card).findByRole('button', { name: 'Buy TEST with 0.1 ETH' }));
    await within(card).findByText(/The receipt shows 5 TEST transferred to you for 0.1 ETH/);
    const tx = chain.state.sent[0];
    expect(tx.to.toLowerCase()).toBe(d.uniswap!.universalRouter.toLowerCase());
    expect(BigInt(tx.value!)).toBe(parseEther('0.1'));
    const { args } = decodeFunctionData({ abi: routerAbi, data: tx.data });
    expect(args[0]).toBe('0x10');
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], (args[1] as Hex[])[0]);
    expect(actions).toBe('0x060c0f');
    const [swap] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            { name: 'poolKey', type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] },
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        },
      ],
      params[0],
    );
    expect(swap.poolKey.hooks.toLowerCase()).toBe(d.poolKey!.hooks.toLowerCase());
    expect(swap.zeroForOne).toBe(true);
    expect(swap.amountOutMinimum).toBe((parseEther('5') * 9900n) / 10000n);
  });

  it('selling asks for the Permit2 approval first, as its own step', async () => {
    const { chain, d } = setup();
    await connect();
    const card = tradeCard();
    fireEvent.click(within(card).getByLabelText('Sell TEST'));
    fireEvent.change(within(card).getByLabelText('TEST to sell'), { target: { value: '2' } });
    fireEvent.click(await within(card).findByRole('button', { name: 'Approve TEST for Permit2' }));
    await within(card).findByText(/Permit2 approved for 2 TEST/);
    expect(chain.state.sent[0].decoded.functionName).toBe('approve');
    expect(String(chain.state.sent[0].decoded.args?.[0]).toLowerCase()).toBe(d.uniswap!.permit2.toLowerCase());
    expect(chain.state.sent[0].decoded.args?.[1]).toBe(parseEther('2'));
    fireEvent.click(await within(card).findByRole('button', { name: 'Allow the Uniswap router' }));
    await within(card).findByText(/Permit2 now lets the router spend 2 TEST/);
    expect(chain.state.sent[1].to.toLowerCase()).toBe(d.uniswap!.permit2.toLowerCase());
    expect(String(chain.state.sent[1].decoded.args?.[1]).toLowerCase()).toBe(d.uniswap!.universalRouter.toLowerCase());
    expect(ACCOUNT).toBeTruthy();
  });
});
