// Thin web binding over the shared @center/core SDK. The public surface
// (api, qs, Page, ApiError, setToken, setUnauthorizedHandler) is unchanged, so no
// calling code needed edits - the transport just moved into the shared package.
// Token lives in memory only (login required each launch).

import { HttpClient, ApiError, qs, type Page } from "@center/core";

let onUnauthorized: (() => void) | null = null;

/**
 * Where the API lives.
 *
 * <p>Unset - the default - means SAME ORIGIN: Vite proxies /api in development,
 * the desktop shell's loopback server proxies it too, and a reverse proxy (or a
 * Vercel rewrite) does it in production. The app never knows where the backend
 * actually is, and there is no CORS to configure.
 *
 * <p>VITE_API_URL overrides that with the backend's own origin, for a frontend
 * hosted apart from its API - a Vercel deployment against a backend on another
 * host. Give it the ORIGIN only ("https://api.example.com"); the /api prefix is
 * appended here, so every call site keeps the same paths. The backend must then
 * name this site in CORS_ALLOWED_ORIGINS or the browser blocks every request.
 *
 * <p>Read at BUILD time, not run time: Vite inlines the value into the bundle,
 * so changing it on the host means rebuilding - on Vercel, a redeploy.
 */
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
const API_BASE = API_ORIGIN ? `${API_ORIGIN}/api` : "/api";

const client = new HttpClient({
  baseUrl: API_BASE,
  onUnauthorized: () => onUnauthorized?.(),
  defaultErrorMessage: "حدث خطأ غير متوقع",
});

/**
 * When set, a GET that fails at the TRANSPORT layer (offline, connection
 * refused, DNS, aborted) is retried against this resolver - the offline sync
 * mirror - which returns the same shape the endpoint would, or undefined for a
 * path it does not mirror (then the original error is rethrown). The sync layer
 * registers it once the engine is up. A GET that reaches the server and gets an
 * HTTP error (an ApiError) is NEVER redirected here - the server's answer wins.
 */
let offlineRead: ((path: string) => Promise<unknown | undefined>) | null = null;

export function setOfflineRead(resolver: ((path: string) => Promise<unknown | undefined>) | null) {
  offlineRead = resolver;
}

/**
 * Statuses that mean "the server could not process this", not "the server
 * considered this and said no".
 *
 * <p>503 is the one that matters day to day. The workspace runs on a laptop and
 * the database is hosted, so when the internet drops the browser still reaches
 * the backend on localhost perfectly well - it is the BACKEND that has lost its
 * database. Those requests used to come back 500, which the app treated as a
 * real server verdict: an error toast on every screen, every few seconds, while
 * a complete offline mirror sat unused. They are indistinguishable from a cut
 * cable as far as the app is concerned, and are handled the same way.
 *
 * <p>Safe for writes too: none of these mean the write was applied. 502/504 are
 * included for the same reason behind a reverse proxy.
 */
const UNREACHABLE_STATUS = new Set([502, 503, 504]);

/**
 * True when an error means "the request never got an answer from the server":
 * a raw fetch/transport failure rather than an HTTP response, or one of the
 * gateway statuses above. ApiError is otherwise the server's own verdict and
 * always wins - EXCEPT a deliberate cancellation (AbortError), which must stay
 * rejected so a superseded search never resolves late with stale mirror data.
 */
export function isOfflineError(err: unknown): boolean {
  if (err instanceof ApiError) return UNREACHABLE_STATUS.has(err.status);
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError") return false;
  return true;
}

/**
 * Set when the backend last answered "I cannot reach my database".
 *
 * <p>`navigator.onLine` does not cover that case: the backend is on localhost,
 * so the browser is perfectly able to reach it and reports itself as online -
 * it is the hosted database that has gone. Without this, EVERY screen has to
 * discover the outage for itself and wait out its own timeout first, so the app
 * crawls and drops an error toast per request. One request finding out is
 * enough; the rest read the mirror immediately.
 *
 * <p>Short window on purpose: it re-probes the network a few seconds later, so
 * the app recovers on its own the moment the line is back rather than staying
 * stuck on local data.
 */
let unreachableUntil = 0;
const UNREACHABLE_GRACE_MS = 10_000;

async function getWithFallback<T>(path: string): Promise<T> {
  // Don't attempt the fetch first when we already know it cannot succeed:
  // either the browser says it is offline, or the backend just told us its
  // database is unreachable. A request against a dead connection can hang for
  // seconds before failing, which made every offline read (search included)
  // crawl. Serve from the mirror straight away; only fall through to the
  // network if the mirror doesn't cover the path.
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  if ((offline || Date.now() < unreachableUntil) && offlineRead) {
    const local = await offlineRead(path);
    if (local !== undefined) return local as T;
  }
  try {
    const res = await client.get<T>(path);
    unreachableUntil = 0; // the line is back
    return res;
  } catch (err) {
    if (isOfflineError(err)) {
      unreachableUntil = Date.now() + UNREACHABLE_GRACE_MS;
      if (offlineRead) {
        const local = await offlineRead(path);
        if (local !== undefined) return local as T;
      }
    }
    throw err;
  }
}

export function setToken(token: string | null) {
  client.setToken(token);
}

export function getToken() {
  return client.getToken();
}

/** Called when the server rejects our token, so the app can return to login. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export const api = {
  // Reads fall back to the offline mirror on a transport failure (see above);
  // writes never do - an offline write is queued explicitly by its caller.
  get: <T>(path: string) => getWithFallback<T>(path),
  post: <T>(path: string, body?: unknown) => client.post<T>(path, body),
  put: <T>(path: string, body?: unknown) => client.put<T>(path, body),
  patch: <T>(path: string, body?: unknown) => client.patch<T>(path, body),
  del: <T>(path: string) => client.delete<T>(path),
};

/**
 * Server-side cap on one page (spring.data.web.pageable.max-page-size).
 *
 * <p>Must match that setting. It sat at 500 while the server allowed 2000, so
 * every full read asked for four times as many pages as it needed to - a
 * workspace of 6,000 students made twelve round trips where three would do.
 */
const MAX_PAGE_SIZE = 2000;

/**
 * Reads EVERY page of a paged endpoint and returns the rows as one array.
 * Tables that filter in the browser need the whole dataset: filtering a single
 * server page would scatter the matches across the original page boundaries.
 * `path` carries its own query string (search, sort, ...) without page/size.
 */
/** Bounds, for the same reasons documented on `cachedGetAll` in dataCache.ts. */
const MAX_PAGES = 20;
const PAGE_CONCURRENCY = 6;

export async function getAllPages<T>(path: string): Promise<T[]> {
  const url = (page: number) =>
    `${path}${path.includes("?") ? "&" : "?"}page=${page}&size=${MAX_PAGE_SIZE}`;

  const first = await api.get<Page<T>>(url(0));
  if (first.total_pages <= 1) return first.content;

  const pages = Math.min(first.total_pages, MAX_PAGES);
  if (first.total_pages > MAX_PAGES) {
    console.warn(
      `getAllPages: ${path} has ${first.total_pages} pages; reading the first ${MAX_PAGES}.`,
    );
  }

  const rest: Page<T>[] = [];
  for (let from = 1; from < pages; from += PAGE_CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(PAGE_CONCURRENCY, pages - from) },
      (_, i) => api.get<Page<T>>(url(from + i)),
    );
    rest.push(...(await Promise.all(batch)));
  }
  return [first, ...rest].flatMap((p) => p.content);
}

/**
 * Downloads a binary response (the student report PDF). The shared SDK only
 * speaks JSON, so this goes straight to fetch and attaches the same bearer
 * token. The server names the file, so its Content-Disposition is returned too.
 */
export async function getFile(path: string): Promise<{ blob: Blob; fileName: string | null }> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError("تعذّر تنزيل الملف", res.status);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  return {
    blob: await res.blob(),
    fileName: match ? decodeURIComponent(match[1]) : null,
  };
}

export { qs, ApiError };
export type { Page };
