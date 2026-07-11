import { deriveSigningKeypair, signData } from './signing';

// Build a signed auth payload for P2P mutating requests.
async function buildAuth(address, signingPublicKey, secretKey, actionFields) {
  const payload = { address, timestamp: Date.now(), ...actionFields };
  const signature = signData(JSON.stringify(payload), secretKey);
  return { address, signingPublicKey, signature, timestamp: payload.timestamp };
}

// Register the signing key with the node (idempotent — safe to call before any mutating action).
async function registerSigningKey(nodeUrl, address, signingPublicKey, secretKey) {
  try {
    const proof = signData(address, secretKey);
    await fetch(`${nodeUrl}/api/wallet/register-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, signingPublicKey, proof }),
    });
  } catch { /* non-fatal */ }
}

// Derive signing keypair from private key hex (cached per session by caller).
export async function getSigningKeys(privateKeyHex) {
  return deriveSigningKeypair(privateKeyHex);
}

// ─── Order book ──────────────────────────────────────────────────────────────

// fetch with a hard timeout — a bare fetch to an unreachable node never settles,
// which left the P2P screen's spinner stuck forever. AbortController + setTimeout
// is used (not AbortSignal.timeout) so it works on all RN/Hermes versions.
async function fetchJSON(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOrders(nodeUrl, { side, quoteCurrency, status } = {}) {
  const params = new URLSearchParams();
  if (side) params.set('side', side);
  if (quoteCurrency) params.set('quoteCurrency', quoteCurrency);
  if (status) params.set('status', status);
  return fetchJSON(`${nodeUrl}/api/p2p/orders?${params}`);
}

export async function fetchMyOrders(nodeUrl, address) {
  return fetchJSON(`${nodeUrl}/api/p2p/orders/my?address=${encodeURIComponent(address)}`);
}

export async function fetchOrder(nodeUrl, orderId) {
  return fetchJSON(`${nodeUrl}/api/p2p/orders/${orderId}`);
}

export async function fetchCurrencies(nodeUrl) {
  return fetchJSON(`${nodeUrl}/api/p2p/currencies`);
}

// ─── Create / cancel order ───────────────────────────────────────────────────

export async function createOrder(nodeUrl, { address, privateKeyHex, side, pohAmount, quoteCurrency, pricePerPOH, minTrade, maxTrade, paymentMethods }) {
  const { signingPublicKey, secretKey } = await getSigningKeys(privateKeyHex);
  await registerSigningKey(nodeUrl, address, signingPublicKey, secretKey);
  const auth = await buildAuth(address, signingPublicKey, secretKey, {
    action: 'create-order', side, pohAmount,
  });
  const body = { ...auth, side, pohAmount, quoteCurrency, pricePerPOH, minTrade, maxTrade, paymentMethods };
  const res = await fetch(`${nodeUrl}/api/p2p/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function cancelOrder(nodeUrl, { address, privateKeyHex, orderId }) {
  const { signingPublicKey, secretKey } = await getSigningKeys(privateKeyHex);
  await registerSigningKey(nodeUrl, address, signingPublicKey, secretKey);
  const auth = await buildAuth(address, signingPublicKey, secretKey, { action: 'cancel-order', orderId });
  const res = await fetch(`${nodeUrl}/api/p2p/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(auth),
  });
  return res.json();
}

// ─── Trade actions ────────────────────────────────────────────────────────────

export async function selectOrder(nodeUrl, { address, privateKeyHex, orderId, pohAmount, quoteAmount }) {
  const { signingPublicKey, secretKey } = await getSigningKeys(privateKeyHex);
  await registerSigningKey(nodeUrl, address, signingPublicKey, secretKey);
  const auth = await buildAuth(address, signingPublicKey, secretKey, {
    action: 'select-order', orderId, pohAmount, quoteAmount,
  });
  const body = { ...auth, pohAmount, quoteAmount };
  const res = await fetch(`${nodeUrl}/api/p2p/orders/${orderId}/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function fetchMyTrades(nodeUrl, address) {
  const res = await fetch(`${nodeUrl}/api/p2p/trades/my?address=${encodeURIComponent(address)}`);
  return res.json();
}

export async function fetchTrade(nodeUrl, tradeId) {
  const res = await fetch(`${nodeUrl}/api/p2p/trades/${tradeId}`);
  return res.json();
}

async function tradeAction(nodeUrl, { address, privateKeyHex, tradeId, action, extra = {} }) {
  const { signingPublicKey, secretKey } = await getSigningKeys(privateKeyHex);
  await registerSigningKey(nodeUrl, address, signingPublicKey, secretKey);
  const auth = await buildAuth(address, signingPublicKey, secretKey, { action, tradeId });
  const res = await fetch(`${nodeUrl}/api/p2p/trades/${tradeId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, ...extra }),
  });
  return res.json();
}

export const markPaymentSent = (nodeUrl, params) => tradeAction(nodeUrl, { ...params, action: 'payment-sent' });
export const releaseTrade    = (nodeUrl, params) => tradeAction(nodeUrl, { ...params, action: 'release' });
export const cancelTrade     = (nodeUrl, params) => tradeAction(nodeUrl, { ...params, action: 'cancel' });
export const disputeTrade    = (nodeUrl, { reason, ...params }) =>
  tradeAction(nodeUrl, { ...params, action: 'dispute', extra: { reason } });

// ─── Referral ─────────────────────────────────────────────────────────────────

export async function fetchReferralStats(nodeUrl, address) {
  const res = await fetch(`${nodeUrl}/api/p2p/referral?address=${encodeURIComponent(address)}`);
  return res.json();
}

export async function applyReferralCode(nodeUrl, address, code, privateKeyHex) {
  const { signingPublicKey, secretKey } = await getSigningKeys(privateKeyHex);
  await registerSigningKey(nodeUrl, address, signingPublicKey, secretKey);
  const auth = await buildAuth(address, signingPublicKey, secretKey, { action: 'apply-referral', code });
  const res = await fetch(`${nodeUrl}/api/p2p/referral/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...auth, code }),
  });
  return res.json();
}
