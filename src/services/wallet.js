import * as Crypto from 'expo-crypto';

/**
 * Derives a POH address from a private key (must match the node implementation).
 * publicKey = sha256(privateKeyHex).hex.slice(0,64)
 * address   = 'poh' + publicKey.slice(0,40)
 */
export async function deriveFromPrivateKey(privateKeyHex) {
  if (!privateKeyHex || privateKeyHex.length < 32) {
    throw new Error('Private key must be at least 32 hex chars');
  }

  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    privateKeyHex,
    { encoding: Crypto.CryptoEncoding.HEX }
  );

  const pub = hash.slice(0, 64);
  const address = 'poh' + pub.slice(0, 40);

  return { address, publicKey: pub, privateKey: privateKeyHex };
}

export async function generateNewWallet() {
  const bytes = await Crypto.getRandomBytesAsync(32);
  const privateKeyHex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return deriveFromPrivateKey(privateKeyHex);
}
