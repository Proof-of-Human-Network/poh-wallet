import { DEFAULT_BOOTNODES } from '../constants';

const PING_TIMEOUT_MS = 4000;

// ── Peer discovery ────────────────────────────────────────────────────────────
// Wallet must try miner.iamai.kg/peers first. If unavailable or empty,
// fall back to other bootnodes. Prefers direct /peers (fast list) then /ipfs/latest.

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
];

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
 * Discover active miner peers.
 * 
 * 1. Tries each bootnode's /peers endpoint (direct list of verified peers with host+walletApiPort).
 *    Primary: miner.iamai.kg/peers, then others.
 * 2. If no usable peers, falls back to /ipfs/latest + IPFS gateways for each bootnode.
 *
 * Returns array of node objects ready for the wallet nodes list:
 *   { url: 'http://host:port', name, wallet, region, verified, source, ... }
 */
export async function discoverPeers() {
  const bootnodes = Array.isArray(DEFAULT_BOOTNODES) && DEFAULT_BOOTNODES.length
    ? DEFAULT_BOOTNODES
    : ['https://miner.iamai.kg'];

  // 1. Prefer direct /peers on each bootnode
  for (const base of bootnodes) {
    try {
      const url = `${base.replace(/\/$/, '')}/peers`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data?.peers) ? data.peers : [];
        const nodes = list
          .filter(p => p && (p.host || p.hostname) && (p.walletApiPort || p.port || p.walletApiPort === 0))
          .map(p => {
            const host = p.host || p.hostname;
            const port = p.walletApiPort || p.port || 3456;
            const scheme = p.scheme || (port === 443 ? 'https' : 'http');
            return {
              url: `${scheme}://${host}:${port}`,
              name: p.wallet ? `${p.wallet.slice(0, 14)}…` : host,
              wallet: p.wallet || null,
              region: p.region || null,
              verified: !!p.verified,
              source: 'bootnode-peers',
            };
          })
          .filter(n => n.url && !n.url.includes('localhost') && !n.url.includes('127.0.0.1')); // prefer public

        if (nodes.length > 0) {
          return nodes;
        }
      }
    } catch {
      // try next bootnode
    }
  }

  // 2. Fallback: /ipfs/latest on each bootnode + IPFS peer dir
  for (const base of bootnodes) {
    try {
      const reg = await fetch(`${base.replace(/\/$/, '')}/ipfs/latest`, {
        signal: AbortSignal.timeout(8000),
      })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);

      if (reg?.peers?.cid) {
        const dir = await fetchIPFSJSON(reg.peers.cid);
        if (Array.isArray(dir?.peers) && dir.peers.length) {
          const nodes = dir.peers
            .filter(p => p && p.host && (p.walletApiPort || p.port))
            .map(p => {
              const prt = p.walletApiPort || p.port || 3456;
              const schm = p.scheme || (prt === 443 ? 'https' : 'http');
              return {
                url: `${schm}://${p.host}:${prt}`,
                name: p.wallet ? `${p.wallet.slice(0, 14)}…` : p.host,
                wallet: p.wallet,
                region: p.region || null,
                source: 'ipfs-directory',
              };
            });
          if (nodes.length > 0) return nodes;
        }
      }

      // chain snapshot fallback (addresses only, less useful for connect)
      if (reg?.chain?.cid) {
        const snap = await fetchIPFSJSON(reg.chain.cid);
        if (snap?.blocks?.length) {
          const wallets = [...new Set(snap.blocks.map(b => b.minerWallet).filter(Boolean))];
          if (wallets.length) {
            return wallets.map(w => ({ wallet: w, source: 'ipfs-chain', cid: reg.chain.cid }));
          }
        }
      }
    } catch {
      // next bootnode
    }
  }

  return [];
}

// Legacy name kept for any external callers; delegates to new logic.
export async function discoverPeersFromIPFS() {
  return discoverPeers();
}

/**
 * Fetch the latest brain weights snapshot from IPFS (tries bootnodes).
 * Returns { weights, feedbackCount } or null.
 */
export async function fetchBrainWeightsFromIPFS() {
  const bootnodes = Array.isArray(DEFAULT_BOOTNODES) && DEFAULT_BOOTNODES.length
    ? DEFAULT_BOOTNODES
    : ['https://miner.iamai.kg'];
  for (const base of bootnodes) {
    try {
      const reg = await fetch(`${base.replace(/\/$/, '')}/ipfs/latest`, {
        signal: AbortSignal.timeout(8000),
      })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
      if (reg?.brain?.cid) {
        return await fetchIPFSJSON(reg.brain.cid);
      }
    } catch {}
  }
  return null;
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

/**
 * Ping all nodes in parallel and return the one with lowest successful latency.
 * Falls back to the first node (with Infinity latency) if none respond.
 */
export async function selectBestNode(nodes) {
  if (!nodes || nodes.length === 0) return null;

  const results = await Promise.all(
    nodes.map(async (node) => {
      const latency = await pingNode(node.url);
      return { ...node, lastLatency: latency };
    })
  );

  const successful = results
    .filter(r => r.lastLatency < Infinity)
    .sort((a, b) => a.lastLatency - b.lastLatency);

  if (successful.length > 0) {
    return successful[0];
  }
  // fallback to first, even if unreachable (so UI has *something*)
  return results[0] || null;
}

/** Chat autocomplete from blockchain job history (Meilisearch / local index on miner). */
export async function fetchChatSuggestions(nodeUrl, { q, wallet, limit = 8 } = {}) {
  if (!nodeUrl || !q || q.length < 2) return { suggestions: [] };
  const base = nodeUrl.replace(/\/$/, '');
  const params = new URLSearchParams({ q, limit: String(limit) });
  if (wallet) params.set('wallet', wallet);
  try {
    const res = await fetch(`${base}/api/search/suggest?${params}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { suggestions: [] };
    return await res.json();
  } catch {
    return { suggestions: [] };
  }
}

/** Find a prior blockchain reply for a repetitive prompt. */
export async function fetchHistoryMatch(nodeUrl, { q, wallet, minScore = 0.82 } = {}) {
  if (!nodeUrl || !q) return null;
  const base = nodeUrl.replace(/\/$/, '');
  const params = new URLSearchParams({ q, minScore: String(minScore) });
  if (wallet) params.set('wallet', wallet);
  try {
    const res = await fetch(`${base}/api/search/history-match?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.match || null;
  } catch {
    return null;
  }
}
