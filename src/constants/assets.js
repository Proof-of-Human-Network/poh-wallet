/**
 * On-chain asset registry — MIRRORS dev/node/src/assets.js (the node is the
 * source of truth; keep tickers/decimals in lockstep). ASCII tickers on the
 * wire (aiETB); Greek display names (αιETB) + currency signs in the UI.
 *
 * DAI: 9 decimals (1 DAI = 1e9 μDAI). Stablecoins: 2 decimals (1 unit = 100 raw).
 */
export const ASSETS = {
  DAI:   { ticker: 'DAI',   decimals: 9, display: 'DAI',   sign: '',    native: true },
  KGST:  { ticker: 'KGST',  decimals: 2, display: 'KGST',  sign: 'som', iso: 'KGS' },
  aiETB: { ticker: 'aiETB', decimals: 2, display: 'αιETB', sign: 'Br',  iso: 'ETB' },
  aiBTN: { ticker: 'aiBTN', decimals: 2, display: 'αιBTN', sign: 'Nu.', iso: 'BTN' },
  aiVES: { ticker: 'aiVES', decimals: 2, display: 'αιVES', sign: 'Bs.', iso: 'VES' },
  aiPYG: { ticker: 'aiPYG', decimals: 2, display: 'αιPYG', sign: '₲',   iso: 'PYG' },
  aiBDT: { ticker: 'aiBDT', decimals: 2, display: 'αιBDT', sign: '৳',   iso: 'BDT' },
  aiPKR: { ticker: 'aiPKR', decimals: 2, display: 'αιPKR', sign: '₨',   iso: 'PKR' },
  aiEGP: { ticker: 'aiEGP', decimals: 2, display: 'αιEGP', sign: 'E£',  iso: 'EGP' },
  aiIQD: { ticker: 'aiIQD', decimals: 2, display: 'αιIQD', sign: 'ع.د', iso: 'IQD' },
  aiAOA: { ticker: 'aiAOA', decimals: 2, display: 'αιAOA', sign: 'Kz',  iso: 'AOA' },
  aiCUP: { ticker: 'aiCUP', decimals: 2, display: 'αιCUP', sign: 'MN$', iso: 'CUP' },
  aiLYD: { ticker: 'aiLYD', decimals: 2, display: 'αιLYD', sign: 'ل.د', iso: 'LYD' },
  aiSDG: { ticker: 'aiSDG', decimals: 2, display: 'αιSDG', sign: 'ج.س', iso: 'SDG' },
  aiIRR: { ticker: 'aiIRR', decimals: 2, display: 'αιIRR', sign: '﷼',   iso: 'IRR' },
};

export const STABLE_TICKERS = [
  'KGST', 'aiETB', 'aiBTN', 'aiVES', 'aiPYG', 'aiBDT', 'aiPKR',
  'aiEGP', 'aiIQD', 'aiAOA', 'aiCUP', 'aiLYD', 'aiSDG', 'aiIRR',
];

/** On-chain assets usable as an order's base or quote leg. Mirrors node p2p/order-store.js. */
export const ONCHAIN_ASSETS = ['DAI', ...STABLE_TICKERS];

export function assetMeta(ticker) {
  return ASSETS[ticker] || { ticker, decimals: 2, display: ticker, sign: '' };
}

export function decimalsOf(ticker) { return assetMeta(ticker).decimals; }

/** Display amount → integer raw units. */
export function toRaw(ticker, displayAmt) {
  return Math.round(Number(displayAmt) * 10 ** decimalsOf(ticker));
}

/** Integer raw units → display amount. */
export function fromRaw(ticker, raw) {
  return Number(raw || 0) / 10 ** decimalsOf(ticker);
}

/** "12.50 αιETB" style human string. */
export function formatAmount(ticker, raw) {
  const a = assetMeta(ticker);
  const v = fromRaw(ticker, raw);
  return `${v.toFixed(a.decimals === 2 ? 2 : 4)} ${a.display}`;
}
