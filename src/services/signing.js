import nacl from 'tweetnacl';
import * as Crypto from 'expo-crypto';

// POH_DECIMALS must match the node (reward.js: 1 POH = 1e9 μPOH)
export const POH_DECIMALS = 1_000_000_000;

// ed25519 DER structure prefixes
const PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);
const SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x70, 0x03, 0x21, 0x00,
]);

function hexToUint8(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

function concatUint8(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

function uint8ToBase64(arr) {
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str);
}

function toPem(label, derBytes) {
  const b64 = uint8ToBase64(derBytes);
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/**
 * Deterministically derive an ed25519 signing keypair from the wallet's private key.
 * Returns PEM-encoded keys (compatible with Node.js crypto) plus raw nacl secretKey for signing.
 */
export async function deriveSigningKeypair(privateKeyHex) {
  const seedHex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    privateKeyHex + ':poh-ed25519-signing-v1',
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  const seed = hexToUint8(seedHex);
  const { publicKey, secretKey } = nacl.sign.keyPair.fromSeed(seed);

  const signingPrivateKey = toPem('PRIVATE KEY', concatUint8(PKCS8_PREFIX, seed));
  const signingPublicKey  = toPem('PUBLIC KEY',  concatUint8(SPKI_PREFIX,  publicKey));

  return { signingPublicKey, signingPrivateKey, secretKey, publicKey };
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
