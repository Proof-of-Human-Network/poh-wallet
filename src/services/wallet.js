import * as Crypto from 'expo-crypto';
import { deriveSigningKeypair } from './signing';

/**
 * Derives a DAI address + signing material from the private key entropy (legacy field).
 * Canonical address is now derived from the ed25519 signing public key (raw base64)
 * to satisfy node's isAddressBoundToSigningKey + register-key.
 * Must produce addresses that allow /api/wallet/register-key and /api/tx/submit to succeed.
 */
export async function deriveFromPrivateKey(privateKeyHex) {
  if (!privateKeyHex || privateKeyHex.length < 32) {
    throw new Error('Private key must be at least 32 hex chars');
  }

  // Derive the ed25519 signing keypair (raw b64 public key as used in txs/register)
  const { signingPublicKey } = await deriveSigningKeypair(privateKeyHex);

  // Canonical address = 'dai' + sha256( signingPublicKey string ).slice(0,40)
  // Matches Wallet.deriveAddressFromSigningKey when passed raw base64 key.
  const addrHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    signingPublicKey,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  const address = 'dai' + addrHash.slice(0, 40);

  // Legacy pub (sha of main priv) kept for storage compat but unused for crypto
  const legacyPubHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    privateKeyHex,
    { encoding: Crypto.CryptoEncoding.HEX }
  );
  const pub = legacyPubHash.slice(0, 64);

  return { address, publicKey: pub, privateKey: privateKeyHex, signingPublicKey };
}

export async function generateNewWallet() {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const privateKeyHex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return deriveFromPrivateKey(privateKeyHex);
}
