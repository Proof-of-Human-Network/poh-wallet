import nacl from 'tweetnacl';
import * as Crypto from 'expo-crypto';

// DAI_DECIMALS must match the node (reward.js: 1 DAI = 1e9 μDAI)
export const DAI_DECIMALS = 1_000_000_000;

function hexToUint8(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

function uint8ToBase64(arr) {
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str);
}

/**
 * Deterministically derive an ed25519 signing keypair from the wallet's private key.
 * signingPublicKey is the raw 32-byte public key in base64 (no PEM/DER encoding).
 * The node's Wallet.verifySignature handles both PEM and raw base64 keys.
 */
export async function deriveSigningKeypair(privateKeyHex) {
  const seedHex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    privateKeyHex + ':dai-ed25519-signing-v1',
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  const seed = hexToUint8(seedHex);
  const { publicKey, secretKey } = nacl.sign.keyPair.fromSeed(seed);

  // Raw base64 of the 32-byte ed25519 public key — node wraps it into SPKI DER internally
  const signingPublicKey = uint8ToBase64(publicKey);

  return { signingPublicKey, secretKey, publicKey };
}

/**
 * Sign arbitrary data with the nacl secretKey.
 * Matches how Node.js Wallet.sign works: signs UTF-8 bytes of the string representation.
 */
export function signData(data, secretKey) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  const msgBytes = new TextEncoder().encode(str);
  const sigBytes = nacl.sign.detached(msgBytes, secretKey);
  return uint8ToBase64(sigBytes);
}

/**
 * Build a signed job-payment proof for fee-required jobs (type 'skill'/'compute').
 *
 * txHash must match the node's computeJobPaymentHash():
 *   sha256(JSON.stringify({ jobId, requesterAddress, minerAddress, amount, nonce }))
 * — field order matters. `nonce` is the CONFIRMED nonce from /api/wallet/nonce
 * (not +1 — the node checks against walletManager.getNonce()).
 * `amount` is in μDAI and must equal the job's maxBudget.
 */
export async function buildJobPaymentTx({ jobId, requesterAddress, minerAddress, amount, nonce, currency, secretKey }) {
  // LOCKSTEP with node computeJobPaymentHash: `currency` joins the preimage as
  // the SIXTH key ONLY when non-DAI — DAI payments keep the historical hash.
  const payload = (currency && currency !== 'DAI')
    ? JSON.stringify({ jobId, requesterAddress, minerAddress, amount, nonce, currency })
    : JSON.stringify({ jobId, requesterAddress, minerAddress, amount, nonce });
  const txHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    payload,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  const signature = signData(txHash, secretKey);
  return { txHash, signature };
}

/**
 * Build a signed DAITransaction ready for POST /api/tx/submit.
 *
 * amount is in display DAI units (e.g. 1.5); converted internally to μDAI.
 * nonce must be currentConfirmedNonce + 1.
 */
export async function buildSignedTransaction({ from, to, amount, fee = 0, nonce, memo = '', currency = 'DAI', secretKey, signingPublicKey }) {
  // Per-asset decimals: DAI ×1e9 (μDAI), stablecoins ×100 (2dp raw units).
  const decimals = (!currency || currency === 'DAI') ? 9 : 2;
  const amountMicro = Math.round(parseFloat(amount) * 10 ** decimals);
  const timestamp = Date.now();

  // txHash must match DAITransaction._computeHash() on the node. LOCKSTEP rule:
  // `currency` joins the preimage after memo ONLY when non-DAI — a DAI tx hashes
  // byte-identically to the historical shape (and carries no currency key).
  const isStable = currency && currency !== 'DAI';
  const payload = isStable
    ? JSON.stringify({ from, to, amount: amountMicro, fee, nonce, timestamp, memo, currency })
    : JSON.stringify({ from, to, amount: amountMicro, fee, nonce, timestamp, memo });
  const txHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    payload,
    { encoding: Crypto.CryptoEncoding.HEX }
  );

  const signature = signData(txHash, secretKey);

  // signingPublicKey is required by DAITransaction.verify() on the node
  return {
    from, to, amount: amountMicro, fee, nonce, timestamp, memo,
    ...(isStable ? { currency } : {}),
    txHash, signature, signingPublicKey,
  };
}
