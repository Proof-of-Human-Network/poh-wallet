/**
 * On-chain asset registry — MIRRORS dev/node/src/assets.js (the node is the
 * source of truth; keep tickers/decimals in lockstep). ASCII tickers on the
 * wire (aiGEL); Greek display names (αιGEL) + currency signs in the UI.
 *
 * POH: 9 decimals (1 POH = 1e9 μPOH). Stablecoins: 2 decimals (1 unit = 100 raw).
 */
export const ASSETS = {
  POH:   { ticker: 'POH',   decimals: 9, display: 'POH',   sign: '',    native: true },
  aiGEL: { ticker: 'aiGEL', decimals: 2, display: 'αιGEL', sign: '₾',   iso: 'GEL' },
  aiKGS: { ticker: 'aiKGS', decimals: 2, display: 'αιKGS', sign: 'som', iso: 'KGS' },
  aiAMD: { ticker: 'aiAMD', decimals: 2, display: 'αιAMD', sign: '֏',   iso: 'AMD' },
  aiETB: { ticker: 'aiETB', decimals: 2, display: 'αιETB', sign: 'Br',  iso: 'ETB' },
  aiBTN: { ticker: 'aiBTN', decimals: 2, display: 'αιBTN', sign: 'Nu.', iso: 'BTN' },
};

export const STABLE_TICKERS = ['aiGEL', 'aiKGS', 'aiAMD', 'aiETB', 'aiBTN'];

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
