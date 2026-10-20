// Coalesce planning reads; Atlas polling checks only a lightweight scope signature.
export function createScopeCache<T>(load: () => Promise<T>, signature: () => Promise<string>, ttl = 20000) {
  let cached: T | undefined, stamp = '', expires = 0;
  let pending: Promise<{ value: T; signature: string }> | undefined;
  const get = async (force = false): Promise<T> => {
    const current = await signature();
    if (pending) {
      const result = await pending;
      if (result.signature === await signature()) return result.value;
      return get();
    }
    if (!force && cached !== undefined && stamp === current && Date.now() < expires) return cached;
    pending = load().then(result => { cached = result; stamp = current; expires = Date.now() + ttl; return { value: result, signature: current }; });
    let result: { value: T; signature: string };
    try { result = await pending; } finally { pending = undefined; }
    if (result.signature !== await signature()) return get();
    return result.value;
  };
  return get;
}
