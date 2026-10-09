// Requests name the planning folder their records came from. If another tab switched the
// server to a different folder, the server answers 409 instead of mixing two folders' records.
export const ROOT_CHANGED = 'planning-root-changed';
let planningRoot: string | null = null;

export function setPlanningRoot(root: string | null) { planningRoot = root; }

export function rootQuery(): Record<string, string> {
  return planningRoot ? { root: planningRoot } : {};
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (planningRoot) headers.set('X-Planning-Root', encodeURIComponent(planningRoot));
  const response = await fetch(url, { ...init, headers });
  if (response.status === 409) {
    const body = await response.clone().json().catch(() => null) as { code?: string } | null;
    if (body?.code === ROOT_CHANGED) window.dispatchEvent(new Event(ROOT_CHANGED));
  }
  return response;
}
