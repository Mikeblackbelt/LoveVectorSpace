import { apiUrl, isNative } from './config';
import { readSSE } from './sse';
import { getAccessToken, readCookie, refreshStore, setAccessToken } from './tokens';
import type { AgentEvent, AuthResult, User } from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;
  retryAfter?: number;
  constructor(status: number, code: string, message: string, field?: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryAfter = retryAfter;
  }
}

type Transport = (url: string, init: RequestInit) => Promise<Response>;

let transport: Transport = (url, init) => fetch(url, init);
let nativeOverride: boolean | null = null;

/** Swap the network layer (mock API in the browser, stubs in tests). */
export function setTransport(t: Transport): void {
  transport = t;
}
export function setNativeOverride(v: boolean | null): void {
  nativeOverride = v;
}
export function nativeMode(): boolean {
  return nativeOverride ?? isNative();
}

// ---------- session events ----------
export type SessionEvent =
  | { type: 'authed'; user: User }
  | { type: 'logged_out' }
  /** the server could not be reached (network error / 5xx during refresh); the session is kept */
  | { type: 'offline' }
  | { type: 'online' };
type SessionListener = (e: SessionEvent) => void;
const listeners = new Set<SessionListener>();
export function onSession(l: SessionListener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function emit(e: Parameters<SessionListener>[0]) {
  listeners.forEach((l) => l(e));
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function baseHeaders(method: string, extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  const at = getAccessToken();
  if (at && !h.has('Authorization')) h.set('Authorization', `Bearer ${at}`);
  if (nativeMode()) {
    h.set('X-Client', 'native');
  } else if (MUTATING.has(method)) {
    // Double-submit CSRF: cookie-authenticated writes must echo lvs_csrf.
    const csrf = readCookie('lvs_csrf');
    if (csrf) h.set('X-CSRF-Token', csrf);
  }
  return h;
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    const b = await res.clone().json();
    return b?.error?.code ?? null;
  } catch {
    return null;
  }
}

async function toError(res: Response): Promise<ApiError> {
  let code = 'http_' + res.status;
  let message = res.statusText || 'Request failed';
  let field: string | undefined;
  try {
    const body = await res.clone().json();
    if (body && body.error) {
      code = body.error.code || code;
      message = body.error.message || message;
      field = body.error.field;
    }
  } catch {
    /* non-JSON error body */
  }
  const ra = res.headers.get('Retry-After');
  return new ApiError(res.status, code, message, field, ra ? Number(ra) : undefined);
}

// ---------- refresh (single flight) ----------
/**
 * ok: new access token · denied: the server rejected the refresh credential (401/403) ·
 * offline: network error or 5xx — the credential is KEPT and the user stays signed in.
 */
export type RefreshOutcome = { kind: 'ok'; result: AuthResult } | { kind: 'denied' } | { kind: 'offline' };
let refreshing: Promise<RefreshOutcome> | null = null;
let offline = false;

function setOffline(v: boolean) {
  if (offline === v) return;
  offline = v;
  emit({ type: v ? 'offline' : 'online' });
}
export function isOffline(): boolean {
  return offline;
}

/**
 * Exchange the refresh credential for a new access token. Refresh tokens rotate
 * and reuse revokes the whole family, so concurrent callers share one request.
 */
export function refreshOutcome(): Promise<RefreshOutcome> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** Back-compat helper: the AuthResult, or null for denied/offline. */
export async function refreshOnce(): Promise<AuthResult | null> {
  const o = await refreshOutcome();
  return o.kind === 'ok' ? o.result : null;
}

async function doRefresh(): Promise<RefreshOutcome> {
  const native = nativeMode();
  let body: string | undefined;
  const headers = new Headers();
  if (native) {
    let rt: string | null | undefined;
    try {
      rt = await refreshStore()?.get();
    } catch {
      return { kind: 'offline' }; // keychain hiccup: keep the session, try later
    }
    if (!rt) return { kind: 'denied' };
    body = JSON.stringify({ refresh_token: rt });
    headers.set('Content-Type', 'application/json');
    headers.set('X-Client', 'native');
  } else {
    const csrf = readCookie('lvs_csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  let res: Response;
  try {
    res = await transport(apiUrl('/api/auth/refresh'), { method: 'POST', headers, body, credentials: native ? 'omit' : 'include' });
  } catch {
    setOffline(true);
    return { kind: 'offline' };
  }
  if (res.status === 401 || res.status === 403) {
    // only an explicit rejection ends the session (and drops the native refresh token)
    setAccessToken(null);
    if (native) await refreshStore()?.clear();
    setOffline(false);
    return { kind: 'denied' };
  }
  if (!res.ok) {
    setOffline(true);
    return { kind: 'offline' };
  }
  const result = (await res.json()) as AuthResult;
  setOffline(false);
  await acceptAuth(result);
  return { kind: 'ok', result };
}

/** Store tokens from any AuthResult (login, signup, refresh, social). */
export async function acceptAuth(result: AuthResult): Promise<void> {
  setAccessToken(result.access_token);
  if (nativeMode() && result.refresh_token) await refreshStore()?.set(result.refresh_token);
  emit({ type: 'authed', user: result.user });
}

export async function clearSession(): Promise<void> {
  setAccessToken(null);
  if (nativeMode()) await refreshStore()?.clear();
  emit({ type: 'logged_out' });
}

// ---------- requests ----------
export interface ReqOpts {
  method?: string;
  json?: unknown;
  form?: FormData;
  headers?: HeadersInit;
  /** set false for /api/auth/* calls that must not trigger a refresh loop */
  retry?: boolean;
  signal?: AbortSignal;
}

export async function rawRequest(path: string, opts: ReqOpts = {}): Promise<Response> {
  const method = (opts.method || 'GET').toUpperCase();
  const send = () => {
    const headers = baseHeaders(method, opts.headers);
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.json !== undefined) {
      body = JSON.stringify(opts.json);
      headers.set('Content-Type', 'application/json');
    }
    return transport(apiUrl(path), { method, headers, body, credentials: nativeMode() ? 'omit' : 'include', signal: opts.signal });
  };
  let res: Response;
  try {
    res = await send();
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') setOffline(true);
    throw e;
  }
  if (res.status < 500) setOffline(false);
  // 503 `unavailable` (not `agent_unavailable`): wait Retry-After (capped) and retry once
  if (res.status === 503 && opts.retry !== false && (await errorCode(res)) === 'unavailable') {
    const ra = Number(res.headers.get('Retry-After'));
    await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(ra) && ra > 0 ? ra : 1, 5) * 1000));
    res = await send();
  }
  if (res.status === 401 && opts.retry !== false) {
    const o = await refreshOutcome();
    if (o.kind === 'ok') res = await send();
    else if (o.kind === 'denied') await clearSession();
    // offline: keep the session; the caller sees the 401 and the app shows an offline banner
  }
  return res;
}

export async function request<T>(path: string, opts: ReqOpts = {}): Promise<T> {
  const res = await rawRequest(path, opts);
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('json')) return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(p: string, o?: ReqOpts) => request<T>(p, { ...o, method: 'GET' }),
  post: <T>(p: string, json?: unknown, o?: ReqOpts) => request<T>(p, { ...o, method: 'POST', json }),
  put: <T>(p: string, json?: unknown, o?: ReqOpts) => request<T>(p, { ...o, method: 'PUT', json }),
  patch: <T>(p: string, json?: unknown, o?: ReqOpts) => request<T>(p, { ...o, method: 'PATCH', json }),
  del: <T>(p: string, json?: unknown, o?: ReqOpts) => request<T>(p, { ...o, method: 'DELETE', json }),
  form: <T>(p: string, form: FormData, o?: ReqOpts) => request<T>(p, { ...o, method: 'POST', form }),
};

/**
 * POST and read a text/event-stream of AgentEvent. A 503 agent_unavailable (or
 * any non-2xx) arrives as JSON before any stream and is thrown as ApiError.
 */
export async function streamAgent(
  path: string,
  json: unknown,
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await rawRequest(path, { method: 'POST', json, signal, headers: { Accept: 'text/event-stream' } });
  if (!res.ok) throw await toError(res);
  if (!res.body) throw new ApiError(500, 'no_stream', 'The reply stream was empty.');
  await readSSE(
    res.body,
    (data) => {
      try {
        onEvent(JSON.parse(data) as AgentEvent);
      } catch {
        /* ignore malformed frame */
      }
    },
    signal,
  );
}
