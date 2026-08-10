// Thin web binding over the shared @center/core SDK. The public surface
// (api, qs, Page, ApiError, setToken, setUnauthorizedHandler) is unchanged, so no
// calling code needed edits - the transport just moved into the shared package.
// Token lives in memory only (login required each launch).

import { HttpClient, ApiError, qs, type Page } from "@center/core";

let onUnauthorized: (() => void) | null = null;

/**
 * Every request is same-origin: Vite proxies /api in development, the reverse
 * proxy does it in production, and the desktop shell serves the app from its own
 * loopback server which proxies /api too. So the app never knows or cares where
 * the backend actually is.
 */
const API_BASE = "/api";

const client = new HttpClient({
  baseUrl: API_BASE,
  onUnauthorized: () => onUnauthorized?.(),
  defaultErrorMessage: "حدث خطأ غير متوقع",
});

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
  get: <T>(path: string) => client.get<T>(path),
  post: <T>(path: string, body?: unknown) => client.post<T>(path, body),
  put: <T>(path: string, body?: unknown) => client.put<T>(path, body),
  patch: <T>(path: string, body?: unknown) => client.patch<T>(path, body),
  del: <T>(path: string) => client.delete<T>(path),
};

/** Server-side cap on one page (spring.data.web.pageable.max-page-size). */
const MAX_PAGE_SIZE = 500;

/**
 * Reads EVERY page of a paged endpoint and returns the rows as one array.
 * Tables that filter in the browser need the whole dataset: filtering a single
 * server page would scatter the matches across the original page boundaries.
 * `path` carries its own query string (search, sort, ...) without page/size.
 */
export async function getAllPages<T>(path: string): Promise<T[]> {
  const url = (page: number) =>
    `${path}${path.includes("?") ? "&" : "?"}page=${page}&size=${MAX_PAGE_SIZE}`;

  const first = await api.get<Page<T>>(url(0));
  if (first.total_pages <= 1) return first.content;

  const rest = await Promise.all(
    Array.from({ length: first.total_pages - 1 }, (_, i) => api.get<Page<T>>(url(i + 1))),
  );
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
