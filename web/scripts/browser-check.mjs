// Browser check of the production export: serves dist/ under /preview/, measures overflow at 320/390/1440,
// opens the connect sheet, and drives an injected test wallet (wrong chain -> 4902 -> add -> switch)
// whose read calls go to the live Sepolia public RPC. It never signs: eth_sendTransaction is rejected.
// Usage: node web/scripts/browser-check.mjs "$PWD/dist" <screenshot-dir>  (needs Playwright + Chromium importable)
import { chromium } from 'playwright';
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const dist = process.argv[2], out = process.argv[3];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith('/preview/')) { res.statusCode = 404; return res.end(); }
  let p = join(dist, u.slice('/preview/'.length) || 'index.html');
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', types[extname(p)] || 'application/octet-stream'); res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/preview/`;
const b = await chromium.launch();
const log = [];
const results = {};
// Injected EIP-1193 test wallet: wallet methods scripted, everything else forwarded to the live public RPC.
const walletInit = ({ chain, account, rpc }) => {
  const listeners = {}; let cur = chain; const known = new Set([cur]); let connected = false;
  window.__walletCalls = [];
  window.ethereum = {
    on: (e, f) => ((listeners[e] ??= []).push(f)), removeListener: (e, f) => (listeners[e] = (listeners[e] || []).filter((x) => x !== f)),
    request: async ({ method, params }) => {
      window.__walletCalls.push({ method, params });
      if (method === 'eth_requestAccounts') { connected = true; return [account]; }
      if (method === 'eth_accounts') return connected ? [account] : [];
      if (method === 'eth_chainId') return '0x' + cur.toString(16);
      if (method === 'wallet_switchEthereumChain') { const id = parseInt(params[0].chainId, 16); if (!known.has(id)) { const e = new Error('Unrecognized chain ID'); e.code = 4902; throw e; } cur = id; (listeners.chainChanged || []).forEach((f) => f(params[0].chainId)); return null; }
      if (method === 'wallet_addEthereumChain') { known.add(parseInt(params[0].chainId, 16)); return null; }
      if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
      if (method === 'eth_sendTransaction') { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
      const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((x) => x.json());
      if (r.error) throw r.error; return r.result;
    },
  };
};
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
for (const w of [320, 390, 1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: w === 1440 ? 900 : 844 } });
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') log.push(`${w} console: ${m.text().slice(0, 200)}`); });
  p.on('requestfailed', (r) => log.push(`${w} failed: ${r.url().slice(0, 120)} ${r.failure()?.errorText}`));
  p.on('response', (r) => { if (r.url().startsWith(url) && r.status() >= 400) log.push(`${w} ${r.status()} ${r.url()}`); });
  await p.goto(url); await p.getByText(/Total staked: [\d,.]+ TEST/).waitFor({ timeout: 30000 });
  await p.getByText(/1 ETH = /).waitFor({ timeout: 30000 }).catch(() => log.push(`${w}: pool price not shown`));
  results[`${w}-overflow`] = await overflow(p);
  results[`${w}-firstScreen`] = await p.evaluate(() => { const b = [...document.querySelectorAll('section.stake button[type=submit]')][0].getBoundingClientRect(); return { stakeButtonBottom: Math.round(b.bottom), viewport: innerHeight }; });
  await p.screenshot({ path: `${out}/${w}-disconnected.png` });
  await p.getByRole('button', { name: 'Connect', exact: true }).click();
  await p.getByRole('dialog').waitFor();
  results[`${w}-sheetOverflow`] = await overflow(p);
  await p.screenshot({ path: `${out}/${w}-sheet.png` });
  await p.keyboard.press('Escape');
  results[`${w}-focusReturned`] = await p.evaluate(() => document.activeElement?.textContent);
  results[`${w}-text`] = (await p.locator('section.stake .meta').first().textContent());
  await ctx.close();
}
// Wallet on mainnet that does not know Sepolia: connect, switch fails with 4902, add, switch.
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(walletInit, { chain: 1, account: '0x2222222222222222222222222222222222222222', rpc: 'https://ethereum-sepolia-rpc.publicnode.com' });
const p = await ctx.newPage();
p.on('console', (m) => { if (m.type() === 'error') log.push(`wallet console: ${m.text().slice(0, 200)}`); });
await p.goto(url); await p.getByText(/Total staked/).waitFor({ timeout: 30000 });
await p.getByRole('button', { name: 'Connect', exact: true }).click();
await p.getByRole('dialog').getByRole('button', { name: /Browser wallet/ }).click();
await p.getByRole('button', { name: 'Switch to Sepolia', exact: true }).waitFor();
results.wrongChainStakeButton = await p.locator('section.stake button[type=submit]').textContent();
await p.screenshot({ path: `${out}/390-wrong-chain.png` });
await p.getByRole('button', { name: 'Switch to Sepolia', exact: true }).click();
await p.getByRole('button', { name: /0x2222…2222/ }).waitFor();
results.walletCalls = (await p.evaluate(() => window.__walletCalls)).filter((c) => c.method.startsWith('wallet_')).map((c) => c.method + (c.method === 'wallet_addEthereumChain' ? ' ' + JSON.stringify(c.params[0]) : ''));
await p.locator('section.stake').getByText('0 TEST').first().waitFor({ timeout: 30000 }).catch(() => log.push('connected balance not shown'));
results.connectedStats = await p.locator('section.stake dl').innerText();
await p.getByLabel('Amount to stake').fill('5');
results.stakeButtonConnected = await p.locator('section.stake button[type=submit]').textContent();
await p.locator('section.stake button[type=submit]').click();
await p.locator('section.stake .error').first().waitFor().catch(() => {});
results.overBalanceError = await p.locator('section.stake .error').first().textContent().catch(() => null);
await p.getByLabel('ETH to spend').fill('0.001');
await p.getByText(/You receive about/).waitFor({ timeout: 30000 }).catch(() => log.push('live quote not shown'));
results.liveQuote = await p.locator('#trade .quote').innerText();
await p.getByRole('button', { name: /0x2222…2222/ }).click();
results.menuOverflow320 = await (async () => { await p.setViewportSize({ width: 320, height: 700 }); return overflow(p); })();
await p.screenshot({ path: `${out}/320-menu.png` });
await p.setViewportSize({ width: 390, height: 844 }); await p.keyboard.press('Escape');
await p.screenshot({ path: `${out}/390-connected-full.png`, fullPage: true });
await b.close(); srv.close();
console.log(JSON.stringify({ results, log }, null, 1));
