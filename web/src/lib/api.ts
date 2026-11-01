export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function getCookie(name: string): string {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&')}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : '';
}

const csrf = () => getCookie('nl_csrf');

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { ...init.headers };
  let body: BodyInit | undefined = init.raw;
  if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf();
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, signal: init.signal, credentials: 'same-origin' });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', '网络连接失败，请检查网络');
  }
  let json: { ok: boolean; data?: T; error?: { code: string; message: string } & Record<string, unknown> } | null = null;
  try {
    json = await res.json();
  } catch {
    /* non-json */
  }
  if (!res.ok || !json?.ok) {
    const err = json?.error;
    if (res.status === 401 && err?.code === 'UNAUTHORIZED' && !path.startsWith('/api/public')) onUnauthorized?.();
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? `请求失败 (${res.status})`, err ?? {});
  }
  return json.data as T;
}

export const get = <T>(path: string, signal?: AbortSignal) => api<T>(path, { signal });
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function qs(params: Record<string, string | number | undefined | null | boolean>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Navigates the browser to a download URL so large files stream straight to disk. */
export function browserDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
