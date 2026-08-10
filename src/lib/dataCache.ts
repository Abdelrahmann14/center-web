// App-wide data cache (stale-while-revalidate).
//
// Reads are keyed by API path. First read fetches; later reads (even from other
// pages) return the cached value INSTANTLY, then revalidate in the background so
// the UI stays fresh without a spinner or a redundant round-trip. Mutations call
// `invalidate(prefix)` to drop stale entries.
//
// In-memory only - cleared on full app reload (fine for a single-user desktop app).

import { useCallback, useEffect, useState } from "react";
import { api, type Page } from "./api";

interface Entry {
  data?: unknown;
  promise?: Promise<unknown>;
  ts: number;
}

const store = new Map<string, Entry>();
const subs = new Map<string, Set<() => void>>();

function notify(path: string) {
  subs.get(path)?.forEach((fn) => fn());
}

function subscribe(path: string, fn: () => void) {
  let set = subs.get(path);
  if (!set) {
    set = new Set();
    subs.set(path, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
  };
}

/** Fetch through the cache. Returns cached data unless `force`, then refreshes. */
export async function cachedGet<T>(path: string, force = false): Promise<T> {
  const e = store.get(path);
  if (!force && e && e.data !== undefined) return e.data as T;
  if (e?.promise) return e.promise as Promise<T>;

  const promise = api
    .get<T>(path)
    .then((data) => {
      store.set(path, { data, ts: Date.now() });
      notify(path);
      return data;
    })
    .catch((err) => {
      // Drop the in-flight marker so a later read can retry.
      const cur = store.get(path);
      if (cur) store.set(path, { data: cur.data, ts: cur.ts });
      throw err;
    });

  store.set(path, { data: e?.data, promise, ts: e?.ts ?? 0 });
  return promise;
}

/** Server-side cap on one page (spring.data.web.pageable.max-page-size). */
const MAX_PAGE_SIZE = 500;

/**
 * Reads EVERY page of a paged endpoint and returns the rows as one array.
 *
 * Tables whose chip filters run in the browser must filter the whole dataset,
 * not one server page: filtering a single page of 10 would show the 3 matches
 * on page 1, then the matches from the next server page on page 2. Pull it all,
 * then filter and paginate client-side.
 *
 * `path` carries the endpoint's own query string (search, sort, ...) without
 * page/size - those are appended here.
 */
export async function cachedGetAll<T>(path: string, force = false): Promise<T[]> {
  const url = (page: number) =>
    `${path}${path.includes("?") ? "&" : "?"}page=${page}&size=${MAX_PAGE_SIZE}`;

  const first = await cachedGet<Page<T>>(url(0), force);
  if (first.total_pages <= 1) return first.content;

  const rest = await Promise.all(
    Array.from({ length: first.total_pages - 1 }, (_, i) => cachedGet<Page<T>>(url(i + 1), force)),
  );
  return [first, ...rest].flatMap((p) => p.content);
}

/**
 * Mark cached entries stale. Keys still shown on screen (with active subscribers)
 * are refreshed in place - old data stays visible until the refetch lands, so no
 * blank/flicker. Unsubscribed keys are dropped so the next mount refetches.
 * No prefix = every key.
 *
 * Prefix matching is what makes this work for paginated reads: invalidating
 * "/students" also clears "/students?page=2&search=..." and every other page.
 */
export function invalidate(prefix?: string) {
  for (const k of [...store.keys()]) {
    if (prefix && !k.startsWith(prefix)) continue;
    if ((subs.get(k)?.size ?? 0) > 0) cachedGet(k, true).catch(() => {});
    else store.delete(k);
  }
}

/** Hard-clear the whole cache (e.g. on logout). No background refetch. */
export function clearCache() {
  store.clear();
  subs.forEach((set) => set.forEach((fn) => fn()));
}

/** Write a value into the cache directly (e.g. after a create/update). */
export function setCache<T>(path: string, data: T) {
  store.set(path, { data, ts: Date.now() });
  notify(path);
}

/**
 * SWR hook. `path = null` disables the read. Returns cached data immediately
 * when present; revalidates in the background on mount.
 */
export function useCachedGet<T>(path: string | null, revalidate = true) {
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  useEffect(() => {
    if (!path) return;
    const unsub = subscribe(path, rerender);
    const e = store.get(path);
    if (!e || e.data === undefined) cachedGet<T>(path).catch(() => {});
    else if (revalidate) cachedGet<T>(path, true).catch(() => {});
    return unsub;
  }, [path, revalidate, rerender]);

  const e = path ? store.get(path) : undefined;
  return {
    data: e?.data as T | undefined,
    loading: !!path && (!e || e.data === undefined),
    reload: () => (path ? cachedGet<T>(path, true) : Promise.resolve(undefined as unknown as T)),
  };
}
