export function localOrigin(origin: string, port: number) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && Number(parsed.port || '80') === port;
  } catch { return false; }
}
