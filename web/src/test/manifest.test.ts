import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalAbiHash, parseDeployment } from '../config';
import { poolId } from '../uniswap';
import { readInputs } from './helpers';

const dist = join(__dirname, '..', '..', '..', 'dist');

describe('runtime deployment configuration', () => {
  it('binds the attested contracts and refuses an ABI that does not match its hash', () => {
    const { manifest, abis, handoff } = readInputs();
    const d = parseDeployment(manifest, abis);
    expect(d.token.address.toLowerCase()).toBe(handoff.contracts[0].address);
    expect(d.staking.address.toLowerCase()).toBe(handoff.contracts[1].address);
    expect(d.chain.id).toBe(11155111);
    const tampered = { ...abis, TestStaking: (abis.TestStaking as unknown[]).slice(1) };
    expect(() => parseDeployment(manifest, tampered)).toThrow(/does not match its attested hash/);
    expect(() => parseDeployment({ ...manifest, contracts: manifest.contracts.map((c) => ({ ...c, abiPath: '../x.json' })) }, abis)).toThrow(/relative/);
  });

  it('computes a pool id from the handoff pool key', () => {
    const { handoff } = readInputs();
    expect(poolId(handoff.poolKey)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it.runIf(existsSync(join(dist, 'imd-deployment.json')))('dist/imd-deployment.json matches the handoff and hashes every exported file', () => {
    const { handoff, net } = readInputs();
    const m = JSON.parse(readFileSync(join(dist, 'imd-deployment.json'), 'utf8'));
    expect(Object.keys(m)).toEqual(['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'poolKey', 'network', 'walletAddChain']);
    expect(m.launchId).toBe(handoff.launchId);
    expect(m.sourceCommit).toBe(handoff.sourceCommit);
    expect(m.attestationHash).toBe(handoff.attestationHash);
    expect(m.poolKey).toEqual(handoff.poolKey);
    expect(m.network).toEqual(net.network);
    expect(m.walletAddChain).toEqual(net.walletAddChain);
    for (const c of m.contracts) {
      const h = handoff.contracts.find((x: { name: string }) => x.name === c.name);
      expect([c.address, c.abiHash]).toEqual([h.address, h.abiHash]);
      expect(canonicalAbiHash(JSON.parse(readFileSync(join(dist, c.abiPath), 'utf8')))).toBe(c.abiHash);
    }
    expect(m.assets.map((a: { path: string }) => a.path)).toContain('index.html');
    for (const a of m.assets) {
      expect(a.path).not.toMatch(/^\/|\.\.|:/);
      expect(createHash('sha256').update(readFileSync(join(dist, a.path))).digest('hex')).toBe(a.sha256);
    }
  });
});
