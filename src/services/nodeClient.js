/**
 * Multi-node resilient client for the POH Miner Wallet.
 * Handles latency-based selection + automatic failover.
 */

export async function pingNode(url) {
  const start = Date.now();
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/wallet/balance?address=ping`, {
      method: 'GET',
    });
    if (res.ok || res.status === 400) {
      return Date.now() - start;
    }
    return Infinity;
  } catch {
    return Infinity;
  }
}

export async function selectBestNode(nodes) {
  if (!nodes || nodes.length === 0) return null;

  const results = await Promise.all(
    nodes.map(async (node) => {
      const latency = await pingNode(node.url);
      return { ...node, lastLatency: latency };
    })
  );

  results.sort((a, b) => a.lastLatency - b.lastLatency);
  const best = results.find(r => r.lastLatency < Infinity);
  return best || results[0];
}

/**
 * Call a node API endpoint with 1 retry + automatic failover to next best node.
 */
export async function callNodeApi(activeNodeUrl, nodes, setActiveNodeUrl, saveActiveNodeUrl, path, options = {}, retries = 1) {
  const currentUrl = activeNodeUrl;
  if (!currentUrl) throw new Error('No active node configured');

  const fullUrl = `${currentUrl.replace(/\/$/, '')}${path}`;

  try {
    const res = await fetch(fullUrl, options);
    return res;
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, 600));
      return callNodeApi(activeNodeUrl, nodes, setActiveNodeUrl, saveActiveNodeUrl, path, options, retries - 1);
    }

    // Failover
    if (nodes.length > 1) {
      const otherNodes = nodes.filter(n => n.url !== currentUrl);
      if (otherNodes.length > 0) {
        const sorted = [...otherNodes].sort((a, b) => (a.lastLatency || 9999) - (b.lastLatency || 9999));
        const nextNode = sorted[0];

        await setActiveNodeUrl(nextNode.url);
        if (saveActiveNodeUrl) await saveActiveNodeUrl(nextNode.url);

        return callNodeApi(nextNode.url, nodes, setActiveNodeUrl, saveActiveNodeUrl, path, options, 1);
      }
    }

    throw err;
  }
}

export async function fetchBalance(activeNodeUrl, nodes, setActiveNodeUrl, saveActiveNodeUrl, address, silent = false) {
  if (!activeNodeUrl || !address) return null;

  try {
    const res = await callNodeApi(
      activeNodeUrl, nodes, setActiveNodeUrl, saveActiveNodeUrl,
      `/api/wallet/balance?address=${address}`
    );
    const data = await res.json();

    if (typeof data.balance === 'number') {
      return data.balance;
    }
  } catch (e) {
    console.log('All nodes unreachable for balance');
  }
  return null;
}

export async function fetchTransactions(activeNodeUrl, nodes, setActiveNodeUrl, saveActiveNodeUrl, address) {
  if (!activeNodeUrl || !address) return [];

  try {
    const res = await callNodeApi(
      activeNodeUrl, nodes, setActiveNodeUrl, saveActiveNodeUrl,
      `/api/wallet/transactions?address=${address}`
    );
    const data = await res.json();
    return Array.isArray(data.transactions) ? data.transactions : [];
  } catch (e) {
    return [];
  }
}
