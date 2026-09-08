#!/usr/bin/env node
/**
 * Generate src/constants/assets.js from the node's src/assets.js.
 *
 * The node decides which currencies exist -- every stablecoin is minted once in
 * the genesis snapshot, so nothing here can add to the set. This file used to
 * be a hand-maintained copy of that list, and the drift between the two copies
 * is exactly how ten currencies ended up formatted at the wrong decimals.
 *
 * fxPerUSD is deliberately NOT copied: it only prices gas on the node, so
 * there should be one place to fix when a rate moves.
 *
 *   node scripts/build-assets.mjs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NODE_ASSETS = process.env.NODE_ASSETS
  || path.join(os.homedir(), 'Desktop/poh/dev/node/src/assets.js');
const OUT = path.join(ROOT, 'src/constants/assets.js');

const src = fs.readFileSync(NODE_ASSETS, 'utf8');
const body = src.slice(src.indexOf('export const ASSETS = {'), src.indexOf('export const STABLE_TICKERS'));

const rows = [];
const re = /^\s*([A-Za-z0-9]+):\s*\{([^}]*)\},/gm;
let m;
while ((m = re.exec(body))) {
  const f = {};
  for (const kv of m[2].matchAll(/(\w+):\s*(?:'((?:\\'|[^'])*)'|([\d.]+|true|false))/g)) {
    f[kv[1]] = kv[2] !== undefined ? kv[2].replace(/\\'/g, "'") : kv[3];
  }
  rows.push({ key: m[1], ...f });
}
if (!rows.length) throw new Error('parsed no assets from the node file');

const pad = (s, n) => String(s).padEnd(n);
const lines = rows.map(a => {
  if (a.native === 'true') {
    return `  ${pad(a.key + ':', 9)}{ ticker: 'DAI', decimals: 9, display: 'DAI', sign: '', native: true },`;
  }
  const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `  ${pad(a.key + ':', 9)}{ ticker: '${a.ticker}', decimals: ${a.decimals}, display: '${a.display}', sign: '${esc(a.sign)}', iso: '${a.iso}', name: '${esc(a.name)}', country: '${esc(a.country)}' },`;
});

const rest = fs.readFileSync(OUT, 'utf8');
const keep = rest.slice(rest.indexOf('export const STABLE_TICKERS'));
const keepAfter = keep.slice(keep.indexOf('export const ONCHAIN_ASSETS'));

const out = `/**
 * On-chain asset registry — GENERATED from dev/node/src/assets.js.
 *
 * Do not hand-edit: run \`node scripts/build-assets.mjs\`. The node is the source
 * of truth for which currencies exist (they are minted once in the genesis
 * snapshot, so this file cannot add to the set); keeping a second hand-written
 * copy is what let tickers and decimals drift apart.
 *
 * ASCII tickers on the wire (aiETB); Greek display names (αιETB) + currency
 * signs in the UI. KGS is the one exception — it shipped as KGST before the
 * convention existed and keeps that name on-chain.
 *
 * DAI: 9 decimals (1 DAI = 1e9 μDAI). Stablecoins: 2 decimals (1 unit = 100
 * raw) for every currency, including the ~30 that are 0-decimal in the real
 * world (IQD, PYG, IRR, JPY, KRW…). Deliberate: the raw-unit maths across node,
 * wallet and SDK assumes it.
 *
 * fxPerUSD is intentionally absent — it only prices gas on the node.
 */
export const ASSETS = {
${lines.join('\n')}
};

export const STABLE_TICKERS = Object.keys(ASSETS).filter(t => t !== 'DAI');

${keepAfter}`;

fs.writeFileSync(OUT, out);
console.log(`wallet assets.js: ${rows.length - 1} stablecoins + DAI (from ${path.relative(os.homedir(), NODE_ASSETS)})`);
