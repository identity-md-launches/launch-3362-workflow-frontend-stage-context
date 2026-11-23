import { zeroAddress, type Address } from 'viem';
import { useDeployment } from '../deployment-context';
import { fmt } from '../format';
import { usePool, useProtocol } from '../hooks';
import { priceFromSqrt } from '../uniswap';

function AddressLink({ address, label }: { address: Address; label?: string }) {
  const d = useDeployment();
  return (
    <a className="mono addr" href={`${d.explorer}/address/${address}`} target="_blank" rel="noreferrer">
      {label ?? address}
    </a>
  );
}

/** Contract, pool and network facts, all from the runtime manifest and live reads. */
export function InfoPanel() {
  const d = useDeployment();
  const p = useProtocol();
  const pool = usePool();
  const key = d.poolKey;
  const uni = d.uniswap;
  const sym = p.symbol;
  const tokenIsC1 = key ? key.currency1.toLowerCase() === d.token.address.toLowerCase() : true;
  const name = (c: Address) => (c === zeroAddress ? `${d.network.nativeCurrency.symbol} (native)` : c.toLowerCase() === d.token.address.toLowerCase() ? sym : c);
  const price = pool.sqrtPriceX96 ? priceFromSqrt(pool.sqrtPriceX96) : undefined;
  const tokensPerPaired = price !== undefined ? (tokenIsC1 ? price : 1 / price) : undefined;
  const nf = (n: number) => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });

  return (
    <section className="card info" aria-labelledby="info-title">
      <h2 id="info-title">Contracts and pool</h2>
      <dl className="facts">
        <div>
          <dt>Network</dt>
          <dd>
            {d.network.name} (chain {d.chain.id}){d.network.testnet ? ', a test network: its ETH has no value' : ''}
          </dd>
        </div>
        <div>
          <dt>{sym} token</dt>
          <dd>
            <AddressLink address={d.token.address} />
          </dd>
        </div>
        <div>
          <dt>TestStaking</dt>
          <dd>
            <AddressLink address={d.staking.address} />
          </dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{p.owner ? <AddressLink address={p.owner} /> : '…'}</dd>
        </div>
        <div>
          <dt>Points emitted</dt>
          <dd className="num">{fmt(p.totalEmitted, 18, 2)}</dd>
        </div>
        {key && (
          <>
            <div>
              <dt>Pool price</dt>
              <dd className="num">
                {tokensPerPaired !== undefined
                  ? `1 ${d.network.nativeCurrency.symbol} = ${nf(tokensPerPaired)} ${sym}`
                  : pool.isLoading
                    ? '…'
                    : 'Unavailable'}
              </dd>
            </div>
            <div>
              <dt>Pool ID</dt>
              <dd className="mono addr">{pool.id}</dd>
            </div>
            <div>
              <dt>Pool key</dt>
              <dd>
                <ul className="plain">
                  <li>currency0: {key.currency0 === zeroAddress ? name(key.currency0) : <AddressLink address={key.currency0} label={`${name(key.currency0)} ${key.currency0}`} />}</li>
                  <li>
                    currency1: <AddressLink address={key.currency1} label={`${name(key.currency1)} ${key.currency1}`} />
                  </li>
                  <li>
                    fee: {key.fee} ({(key.fee / 10_000).toLocaleString('en-US')}%), tick spacing: {key.tickSpacing}
                  </li>
                  <li>
                    hooks: <AddressLink address={key.hooks} />
                  </li>
                </ul>
              </dd>
            </div>
          </>
        )}
        {uni && (
          <div>
            <dt>Uniswap v4</dt>
            <dd>
              <ul className="plain">
                <li>
                  PoolManager <AddressLink address={uni.poolManager} />
                </li>
                <li>
                  Universal Router <AddressLink address={uni.universalRouter} />
                </li>
                <li>
                  Quoter <AddressLink address={uni.quoter} />
                </li>
                <li>
                  Permit2 <AddressLink address={uni.permit2} />
                </li>
              </ul>
            </dd>
          </div>
        )}
        <div>
          <dt>Source</dt>
          <dd className="mono addr">
            commit {d.manifest.sourceCommit}, attestation {d.manifest.attestationHash}
          </dd>
        </div>
        {d.network.faucets && d.network.faucets.length > 0 && (
          <div>
            <dt>Test ETH</dt>
            <dd>
              <ul className="plain">
                {d.network.faucets.map((f) => (
                  <li key={f}>
                    <a href={f} target="_blank" rel="noreferrer">
                      {new URL(f).hostname} faucet
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
