import nacl from 'tweetnacl';
import * as Crypto from 'expo-crypto';

// POH_DECIMALS must match the node (reward.js: 1 POH = 1e9 μPOH)
export const POH_DECIMALS = 1_000_000_000;

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
    privateKeyHex + ':poh-ed25519-signing-v1',
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
 * Build a signed PoHTransaction ready for POST /api/tx/submit.
 *
 * amount is in display POH units (e.g. 1.5); converted internally to μPOH.
 * nonce must be currentConfirmedNonce + 1.
 */
export async function buildSignedTransaction({ from, to, amount, fee = 0, nonce, memo = '', secretKey, signingPublicKey }) {
  const amountMicro = Math.round(parseFloat(amount) * POH_DECIMALS);
  const timestamp = Date.now();

  // txHash must match PoHTransaction._computeHash() on the node
  const payload = JSON.stringify({ from, to, amount: amountMicro, fee, nonce, timestamp, memo });
  const txHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    payload,
    { encoding: Crypto.CryptoEncoding.HEX }
  );

  const signature = signData(txHash, secretKey);

  // signingPublicKey is required by PoHTransaction.verify() on the node
  return { from, to, amount: amountMicro, fee, nonce, timestamp, memo, txHash, signature, signingPublicKey };
}
