/**
 * Give tweetnacl a randomness source.
 *
 * React Native has no global crypto.getRandomValues, and tweetnacl refuses to
 * invent one — any call needing entropy throws "no PRNG". That is why signing
 * always worked while pairing did not: signing derives its keypair with
 * nacl.sign.keyPair.fromSeed (deterministic, no entropy), whereas a pairing
 * session needs nacl.box.keyPair() and a fresh nonce per message.
 *
 * expo-crypto is already a dependency and its getRandomBytes is synchronous,
 * which is what setPRNG requires — the async variant cannot be used here.
 *
 * Import this module for its side effect before touching nacl. It is imported
 * explicitly rather than relied on transitively, so removing an unrelated
 * import can never silently take the PRNG with it and bring "no PRNG" back.
 */
import nacl from 'tweetnacl';
import * as Crypto from 'expo-crypto';

let installed = false;

export function installPRNG() {
  if (installed) return;
  nacl.setPRNG((x, n) => {
    const bytes = Crypto.getRandomBytes(n);
    for (let i = 0; i < n; i++) x[i] = bytes[i];
    // Don't leave a second copy of the entropy lying around.
    bytes.fill(0);
  });
  installed = true;
}

installPRNG();
