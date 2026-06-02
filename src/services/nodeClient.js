const PING_TIMEOUT_MS = 4000;

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
