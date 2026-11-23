import { WalletControl } from './wallet/WalletControl';
import { StakePanel } from './panels/StakePanel';
import { TradePanel } from './panels/TradePanel';
import { InfoPanel } from './panels/InfoPanel';
import { OwnerPanel } from './panels/OwnerPanel';
import { useDeployment } from './deployment-context';

export function App({ mobile }: { mobile?: boolean }) {
  const d = useDeployment();
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <a className="brand" href="./" aria-label="Test staking home">
          <img src="./favicon.svg" width={28} height={28} alt="" />
          <span>Test staking</span>
        </a>
        <WalletControl mobile={mobile} />
      </header>
      <main id="main" className="page">
        <div className="hero">
          <h1>Stake TEST, earn points</h1>
          <p className="lede">
            Stake Test (TEST) on {d.network.name} to earn points every second, in proportion to your share of all TEST staked.
          </p>
        </div>
        <div className="grid">
          <StakePanel />
          <TradePanel />
        </div>
        <OwnerPanel />
        <InfoPanel />
      </main>
      <footer className="foot">
        <p>
          Points are an onchain score kept by TestStaking. They are not a token and cannot be transferred. Withdrawing returns your TEST and keeps
          your points.
        </p>
      </footer>
    </>
  );
}
