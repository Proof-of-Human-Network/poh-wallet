import nacl from 'tweetnacl';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { deriveSigningKeypair, signData } from './signing';

/**
 * Remote-signer sessions.
 *
 * aist.exchange runs in a browser, which must never hold a DAI key — the same
 * key signs on-chain transfers and authorises escrow release. So the browser
 * shows a QR, and this device becomes the signer: it approves each action and
 * returns only a signature.
 *
 * The private key never leaves the phone. What crosses the relay is a sealed
 * box; the relay itself is untrusted and sees only ciphertext.
 *
 * The `topic` in the QR is the capability. Anyone who has it can talk to the
 * session, which is why it only ever travels in the QR the user scans.
 */

const PROTOCOL = 1;
const POLL_WAIT_MS = 20000;              // under the relay's 25s ceiling
const SESSION_TTL_MS = 30 * 60 * 1000;   // a session is a working window
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000; // the node's own auth window

/**
 * Only these ever get signed. A relay or a compromised page cannot ask for
 * something outside this list, and anything unknown is refused before the user
 * is even prompted.
 */
export const ACTION_ALLOWLIST = new Set([
  'select-order', 'payment-sent', 'release', 'cancel', 'dispute',
  'create-order', 'cancel-order', 'apply-referral',
]);

const b64 = {
  enc: (u8) => global.btoa(String.fromCharCode.apply(null, Array.from(u8))),
  dec: (s) => Uint8Array.from(global.atob(s), (c) => c.charCodeAt(0)),
};
const utf8 = {
  enc: (s) => new TextEncoder().encode(s),
  dec: (u8) => new TextDecoder().decode(u8),
};

/** Keys must sit in the OS keystore before we let this device sign for others. */
export async function isSecureEnough() {
  try {
    if (Platform.OS === 'web') return false;
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Parse the QR / connection link the browser shows. */
export function parsePairingUri(uri) {
  if (typeof uri !== 'string') throw new Error('bad-uri');
  const trimmed = uri.trim();
  if (!/^aist:\/\/pair\?/.test(trimmed)) throw new Error('not-a-pairing-code');
  const q = {};
  for (const part of trimmed.slice(trimmed.indexOf('?') + 1).split('&')) {
    const [k, v = ''] = part.split('=');
    q[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  if (Number(q.v || 1) !== PROTOCOL) throw new Error('unsupported-version');
  if (!/^[0-9a-f]{64}$/.test(q.topic || '')) throw new Error('bad-topic');
  if (!/^https?:\/\//.test(q.relay || '')) throw new Error('bad-relay');
  let browserKey;
  try {
    browserKey = b64.dec(q.k || '');
    if (browserKey.length !== nacl.box.publicKeyLength) throw new Error();
  } catch { throw new Error('bad-key'); }
  return { version: PROTOCOL, relay: q.relay.replace(/\/$/, ''), topic: q.topic, browserKey };
}

/**
 * One live pairing. Bound to exactly one DAI address: a session signs for that
 * address and nothing else, so connecting a site never exposes the rest of the
 * user's wallets.
 */
export class PairSession {
  constructor({ uri, address, privateKeyHex, label }) {
    const parsed = parsePairingUri(uri);
    this.relay = parsed.relay;
    this.topic = parsed.topic;
    this.browserKey = parsed.browserKey;
    this.address = address;
    this.privateKeyHex = privateKeyHex;
    this.label = label || null;
    this.kp = nacl.box.keyPair();
    this.cursor = 0;
    this.startedAt = Date.now();
    this.expiresAt = this.startedAt + SESSION_TTL_MS;
    this.revoked = false;
    this._keys = null;                 // derived ed25519 pair, cached per session
  }

  get id() { return this.topic; }
  get expired() { return Date.now() > this.expiresAt; }
  get live() { return !this.revoked && !this.expired; }

  async _signingKeys() {
    if (!this._keys) this._keys = await deriveSigningKeypair(this.privateKeyHex);
    return this._keys;
  }

  /* The sender's box public key rides in the clear on every frame: the peer
     cannot open the first message without it, and it cannot be hidden inside
     the body it is needed to open. It is a public key, so this costs nothing. */
  _seal(obj) {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const box = nacl.box(utf8.enc(JSON.stringify(obj)), nonce, this.browserKey, this.kp.secretKey);
    return JSON.stringify({ k: b64.enc(this.kp.publicKey), n: b64.enc(nonce), b: b64.enc(box) });
  }

  _open(payload) {
    try {
      const { n, b } = JSON.parse(payload);
      const opened = nacl.box.open(b64.dec(b), b64.dec(n), this.browserKey, this.kp.secretKey);
      return opened ? JSON.parse(utf8.dec(opened)) : null;
    } catch { return null; }
  }

  async _publish(obj) {
    const res = await fetch(`${this.relay}/api/pair/${this.topic}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'signer', payload: this._seal(obj) }),
    });
    return res.json();
  }

  /** Tell the browser which address this session will sign for. */
  async hello() {
    return this._publish({
      t: 'hello',
      k: b64.enc(this.kp.publicKey),
      address: this.address,
      label: this.label || 'phone',
    });
  }

  async revoke() {
    this.revoked = true;
    try { await this._publish({ t: 'revoked' }); } catch { /* best effort */ }
  }

  /** One long-poll. Returns the requests waiting for a decision. */
  async poll(signal) {
    const url = `${this.relay}/api/pair/${this.topic}`
      + `?since=${this.cursor}&wait=${POLL_WAIT_MS}&as=signer`;
    const res = await fetch(url, { signal });
    const body = await res.json();
    if (body.error) throw new Error(body.error);
    const out = [];
    for (const m of body.messages || []) {
      this.cursor = Math.max(this.cursor, m.seq);
      const req = this._open(m.payload);
      if (req && req.t === 'sign') out.push(req);
    }
    return out;
  }

  /**
   * Why a request must be refused, or null if it may be shown to the user.
   * Checked BEFORE prompting, so the user is never asked about something we
   * would not sign anyway.
   */
  reasonToRefuse(req) {
    if (!this.live) return this.revoked ? 'session revoked' : 'session expired';
    if (!req || typeof req.action !== 'string') return 'malformed request';
    if (!ACTION_ALLOWLIST.has(req.action)) return `unsupported action: ${req.action}`;
    if (req.fields && typeof req.fields !== 'object') return 'malformed fields';
    return null;
  }

  async reject(req, reason) {
    return this._publish({ t: 'rejected', id: req.id, reason: reason || 'declined' });
  }

  /**
   * Sign an approved request.
   *
   * The payload is built HERE, not taken from the browser, and the timestamp is
   * stamped at approval time — so a page cannot get a stale or differently
   * shaped payload signed. Key order is the node's contract:
   * { address, timestamp, action, ...fields }.
   */
  async approve(req) {
    const refusal = this.reasonToRefuse(req);
    if (refusal) { await this.reject(req, refusal); throw new Error(refusal); }

    const { signingPublicKey, secretKey } = await this._signingKeys();
    const timestamp = Date.now();
    const payload = JSON.stringify({
      address: this.address, timestamp, action: req.action, ...(req.fields || {}),
    });
    return this._publish({
      t: 'signed',
      id: req.id,
      address: this.address,
      signingPublicKey,
      signature: signData(payload, secretKey),
      timestamp,
    });
  }

  /** Register the signing key so the node can resolve this address. Idempotent. */
  async registerKey(nodeUrl) {
    const { signingPublicKey, secretKey } = await this._signingKeys();
    try {
      await fetch(`${nodeUrl || this.relay}/api/wallet/register-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: this.address,
          signingPublicKey,
          proof: signData(this.address, secretKey),
        }),
      });
    } catch { /* non-fatal; the first signed call will surface a real failure */ }
  }

  /** What the sessions list shows. Never includes key material. */
  summary() {
    return {
      id: this.id,
      relay: this.relay,
      address: this.address,
      label: this.label,
      startedAt: this.startedAt,
      expiresAt: this.expiresAt,
      revoked: this.revoked,
      expired: this.expired,
    };
  }
}

/** A request rendered for a human. Never show raw JSON as the primary display. */
export function describeRequest(req, address) {
  const f = (req && req.fields) || {};
  const h = (req && req.human) || {};
  const rows = [];
  if (f.orderId) rows.push(['Order', String(f.orderId).slice(0, 8)]);
  if (f.tradeId) rows.push(['Trade', String(f.tradeId).slice(0, 8)]);
  if (f.daiAmount != null) rows.push(['Amount', String(f.daiAmount)]);
  if (f.quoteAmount != null) rows.push(['You pay', String(f.quoteAmount)]);
  if (f.side) rows.push(['Side', String(f.side)]);
  if (f.code) rows.push(['Code', String(f.code)]);
  rows.push(['Signing as', address]);
  return {
    title: h.title || req.action,
    detail: h.detail || null,
    warning: h.warning || null,
    action: req.action,
    rows,
  };
}

export const PAIRING_LIMITS = { PROTOCOL, SESSION_TTL_MS, POLL_WAIT_MS, MAX_CLOCK_SKEW_MS };
