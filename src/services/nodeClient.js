const PING_TIMEOUT_MS = 4000;

// ── IPFS fallback ─────────────────────────────────────────────────────────────
// When no configured node responds, the wallet can bootstrap peer discovery
// and chain state from the IPFS snapshots published by miners.

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
];
const BOOTNODE_URL = 'https://bootnode.proofofhuman.ge';

async function fetchIPFSJSON(cid) {
  for (const gw of IPFS_GATEWAYS) {
    try {
      const res = await fetch(`${gw}${cid}`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) return await res.json();
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Query the bootnode for the latest IPFS CIDs, then fetch the chain snapshot
 * and return the peer list embedded in it.
 * Returns [] if IPFS is unreachable or no snapshot is available.
 */
export async function discoverPeersFromIPFS() {
  try {
    const reg = await fetch(`${BOOTNODE_URL}/ipfs/latest`, { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null).catch(() => null);
    if (!reg?.chain?.cid) return [];

    const snap = await fetchIPFSJSON(reg.chain.cid);
    if (!snap?.blocks?.length) return [];

    // Extract unique miner wallets from the snapshot and turn them into
    // synthetic node entries that the wallet can try to connect to.
    // In production the snapshot would include host:port; for now we
    // surface the wallets so the UI can show network activity.
    const wallets = [...new Set(snap.blocks.map(b => b.minerWallet).filter(Boolean))];
    return wallets.map(w => ({ wallet: w, source: 'ipfs', cid: reg.chain.cid }));
  } catch { return []; }
}

/**
 * Fetch the latest brain weights snapshot from IPFS.
 * Returns { weights, feedbackCount } or null.
 */
export async function fetchBrainWeightsFromIPFS() {
  try {
    const reg = await fetch(`${BOOTNODE_URL}/ipfs/latest`, { signal: AbortSignal.timeout(8000) })
      .then(r => r.ok ? r.json() : null).catch(() => null);
    if (!reg?.brain?.cid) return null;
    return await fetchIPFSJSON(reg.brain.cid);
  } catch { return null; }
}

export async function pingNode(url) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/wallet/balance?address=ping`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok || res.status === 400) {
      return Date.now() - start;
    }
    return Infinity;
  } catch {
    clearTimeout(timer);
    return Infinity;
  }
}

// Returns the first node that responds successfully; falls back to first result
// when all nodes are unreachable (so callers always get a non-null value).
export async function selectBestNode(nodes) {
  if (!nodes || nodes.length === 0) return null;

  return new Promise((resolve) => {
    let resolved = false;
    let pending = nodes.length;
    let firstResult = null;

    nodes.forEach(async (node) => {
      const latency = await pingNode(node.url);
      const result = { ...node, lastLatency: latency };

      if (!firstResult) firstResult = result;
      pending--;

      if (!resolved && latency < Infinity) {
        resolved = true;
        resolve(result);
        return;
      }

      if (pending === 0 && !resolved) {
        resolve(firstResult);
      }
    });
  });
}
