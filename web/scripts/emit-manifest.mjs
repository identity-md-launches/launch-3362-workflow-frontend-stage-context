// Runs after `vite build`: copies the verified ABIs into dist/abi, hashes every exported file
// and writes dist/imd-deployment.json, the app's only runtime deployment configuration.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { buildManifest, loadInputs, repoRoot, sha256 } from './manifest-lib.mjs';

const dist = join(repoRoot, 'dist');
const MANIFEST = 'imd-deployment.json';
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024; // well under half of the checker's 64 MiB budget

const inputs = loadInputs();
mkdirSync(join(dist, 'abi'), { recursive: true });
for (const a of inputs.abis) writeFileSync(join(dist, a.path), a.bytes);

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
let total = 0;
const assets = walk(dist)
  .map((p) => relative(dist, p).split(sep).join('/'))
  .filter((p) => p !== MANIFEST)
  .sort()
  .map((p) => {
    const bytes = readFileSync(join(dist, p));
    if (bytes.length > MAX_FILE) throw new Error(`${p} exceeds 8 MiB`);
    total += bytes.length;
    return { path: p, sha256: sha256(bytes) };
  });
if (!assets.some((a) => a.path === 'index.html')) throw new Error('index.html missing from export');
if (assets.length > 128) throw new Error(`${assets.length} assets exceeds 128`);
if (total > MAX_TOTAL) throw new Error(`export is ${total} bytes, over the ${MAX_TOTAL} budget`);
writeFileSync(join(dist, MANIFEST), JSON.stringify(buildManifest(inputs, assets), null, 2) + '\n');
console.log(`imd-deployment.json: ${assets.length} assets, ${total} bytes`);
