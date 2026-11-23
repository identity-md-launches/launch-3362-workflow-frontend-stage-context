import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccount, useConnect, useDisconnect, type Connector } from 'wagmi';
import { useDeployment } from '../deployment-context';
import { explain } from '../errors';
import { short } from '../format';
import { OPEN_IN, isMobileBrowser } from './open-in';
import { switchToDeploymentChain } from './switch';
import { iconSrc } from './wallet-icons';

/** The one wallet control: Connect (opens the sheet), Switch to <chain>, or the connected address menu. */
export function WalletControl({ mobile: forcedMobile }: { mobile?: boolean }) {
  const d = useDeployment();
  const { address, isConnected, chainId, connector } = useAccount();
  const [switching, setSwitching] = useState(false);
  const [note, setNote] = useState<string>();

  if (isConnected && address && chainId !== d.chain.id) {
    const onSwitch = async () => {
      if (!connector) return;
      setSwitching(true);
      setNote(undefined);
      try {
        const provider = (await connector.getProvider()) as Parameters<typeof switchToDeploymentChain>[0];
        await switchToDeploymentChain(provider, d);
      } catch (e) {
        setNote(explain(e));
      } finally {
        setSwitching(false);
      }
    };
    return (
      <div className="wallet">
        <button className="btn btn-primary" onClick={onSwitch} disabled={switching} aria-describedby={note ? 'switch-note' : undefined}>
          {switching ? 'Switching…' : `Switch to ${d.network.name}`}
        </button>
        {note && (
          <p className="wallet-note" id="switch-note" role="alert">
            {note}
          </p>
        )}
      </div>
    );
  }
  if (isConnected && address) return <AccountMenu address={address} />;
  return <ConnectSheet mobile={forcedMobile} />;
}

function AccountMenu({ address }: { address: string }) {
  const d = useDeployment();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('keydown', onKey);
    addEventListener('mousedown', onDown);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('mousedown', onDown);
    };
  }, [open]);
  return (
    <div className="wallet" ref={ref}>
      <button ref={btn} className="btn" aria-expanded={open} aria-controls="account-menu" onClick={() => setOpen((o) => !o)}>
        <span className="mono">{short(address)}</span>
      </button>
      {open && (
        <div className="menu" id="account-menu">
          <p className="menu-addr mono">{address}</p>
          <button
            className="menu-item"
            onClick={async () => {
              await navigator.clipboard?.writeText(address).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <a className="menu-item" href={`${d.explorer}/address/${address}`} target="_blank" rel="noreferrer">
            View on explorer
          </a>
          <button className="menu-item" onClick={() => disconnect()}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

/** Connect sheet: EIP-6963 wallets by name, then Coinbase Wallet; on a phone, "Open in" rows first. */
export function ConnectSheet({ open: forced, mobile: forcedMobile }: { open?: boolean; mobile?: boolean }) {
  const mobile = forcedMobile ?? isMobileBrowser();
  const { isConnected } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const [open, setOpen] = useState(forced ?? false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const close = () => {
    setOpen(false);
    reset();
  };
  // Return focus to the trigger once the sheet is gone and the page is no longer inert.
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      trigger.current?.focus();
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    addEventListener('keydown', onKey);
    sheet.current?.querySelector<HTMLElement>('button, a')?.focus();
    const main = document.getElementById('app-root');
    main?.setAttribute('inert', '');
    return () => {
      removeEventListener('keydown', onKey);
      main?.removeAttribute('inert');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (isConnected) setOpen(false);
  }, [isConnected]);

  const named = connectors.some((c) => c.type === 'injected' && c.id !== 'injected');
  const listed = [...connectors.filter((c) => c.type === 'injected'), ...connectors.filter((c) => c.type !== 'injected')].filter(
    (c) => !(c.id === 'injected' && named),
  );
  const label = (c: Connector) =>
    c.id === 'injected' ? 'Browser wallet' : c.id === 'coinbaseWalletSDK' && mobile ? 'Coinbase Smart Wallet' : c.name;
  const icon = (c: Connector) => c.icon ?? iconSrc(c.id);

  return (
    <>
      <button ref={trigger} className="btn btn-primary" onClick={() => setOpen(true)}>
        Connect
      </button>
      {open &&
        createPortal(
        <div className="sheet-bg" onClick={close}>
          <div className="sheet" ref={sheet} role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 id="sheet-title">Connect a wallet</h2>
              <button className="x" aria-label="Close" onClick={close}>
                ×
              </button>
            </div>
            {mobile &&
              OPEN_IN.map((w) => (
                <a key={w.id} className="row" href={w.href(location.href)}>
                  <span className="ic">{iconSrc(w.id) && <img width={28} height={28} src={iconSrc(w.id)} alt="" />}</span>
                  <span>Open in {w.name}</span>
                </a>
              ))}
            {listed
              .filter((c) => !mobile || c.type !== 'injected')
              .map((c) => (
                <button key={c.uid} className="row" onClick={() => connect({ connector: c })} disabled={isPending}>
                  <span className="ic">{icon(c) ? <img width={28} height={28} src={icon(c)} alt="" /> : <BrowserIcon />}</span>
                  <span>
                    {label(c)}
                    {isPending && variables?.connector === c ? ' · opening…' : ''}
                  </span>
                </button>
              ))}
            {error && (
              <p className="sheet-note" role="status">
                {explain(error)}
              </p>
            )}
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}

function BrowserIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="3" y="6" width="22" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 11h22" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
