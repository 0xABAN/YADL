/** Shared fetch helper for /api/* (proxied to backend). */

export class ApiError extends Error {
  constructor(
    public status: number,
    message?: string,
  ) {
    super(message ?? String(status));
    this.name = "ApiError";
  }
}

export type ApiOptions = RequestInit & {
  /** Skip JSON parse (raw Response). */
  raw?: boolean;
  /** Don't redirect on 401. */
  noAuthRedirect?: boolean;
};

/**
 * GET/mutate `/api${path}`. Throws ApiError on non-OK.
 * 401 → `/auth` unless noAuthRedirect.
 */
export async function api<T = unknown>(path: string, init?: ApiOptions): Promise<T> {
  const { raw, noAuthRedirect, ...rest } = init ?? {};
  const r = await fetch(`/api${path}`, rest);
  if (r.status === 401) {
    if (!noAuthRedirect && typeof location !== "undefined") location.href = "/auth";
    throw new ApiError(401, "auth_required");
  }
  if (raw) return r as unknown as T;
  if (!r.ok) throw new ApiError(r.status);
  if (r.status === 204) return undefined as T;
  return r.json() as Promise<T>;
}

/** Like api but returns Result instead of throw (for auth-aware callers). */
export async function apiResult<T = unknown>(
  path: string,
  init?: ApiOptions,
): Promise<{ ok: true; data: T } | { ok: false; status: number; data?: unknown }> {
  const { raw, noAuthRedirect, ...rest } = init ?? {};
  const r = await fetch(`/api${path}`, rest);
  if (r.status === 401) {
    if (!noAuthRedirect && typeof location !== "undefined") location.href = "/auth";
    return { ok: false, status: 401 };
  }
  const data = raw ? r : await r.json().catch(() => null);
  if (!r.ok) return { ok: false, status: r.status, data };
  return { ok: true, data: data as T };
}
