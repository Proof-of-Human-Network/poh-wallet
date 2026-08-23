/**
 * On-chain asset registry — MIRRORS dev/node/src/assets.js (the node is the
 * source of truth; keep tickers/decimals in lockstep). ASCII tickers on the
 * wire (aiGEL); Greek display names (αιGEL) + currency signs in the UI.
 *
 * DAI: 9 decimals (1 DAI = 1e9 μDAI). Stablecoins: 2 decimals (1 unit = 100 raw).
 */
export const ASSETS = {
  DAI:   { ticker: 'DAI',   decimals: 9, display: 'DAI',   sign: '',    native: true },
  aiGEL: { ticker: 'aiGEL', decimals: 2, display: 'αιGEL', sign: '₾',   iso: 'GEL' },
  KGST:  { ticker: 'KGST',  decimals: 2, display: 'KGST',  sign: 'som', iso: 'KGS' },
  aiETB: { ticker: 'aiETB', decimals: 2, display: 'αιETB', sign: 'Br',  iso: 'ETB' },
  aiBTN: { ticker: 'aiBTN', decimals: 2, display: 'αιBTN', sign: 'Nu.', iso: 'BTN' },
};

export const STABLE_TICKERS = ['aiGEL', 'KGST', 'aiETB', 'aiBTN'];

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

/** "12.50 αιGEL" style human string. */
export function formatAmount(ticker, raw) {
  const a = assetMeta(ticker);
  const v = fromRaw(ticker, raw);
  return `${v.toFixed(a.decimals === 2 ? 2 : 4)} ${a.display}`;
}
