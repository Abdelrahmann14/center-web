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

/**
 * Most entries the cache keeps.
 *
 * Keys are full URLs, so every distinct search string - and every page of it -
 * is its own entry, and nothing ever removed one. A shift at the registration
 * desk searching for fifty students left fifty result sets, each up to twenty
 * pages of five hundred rows, alive in the tab until someone reloaded it. That
 * was the app's one real source of unbounded memory growth: a long-lived tab
 * got heavier all day and never gave anything back.
 *
 * A count rather than a byte budget, because row size is not something this
 * layer can measure honestly. Two hundred is far more than any screen holds at
 * once, and an evicted key just refetches - it was stale anyway.
 */
const MAX_ENTRIES = 200;

/**
 * Move a key to the end of the Map, so insertion order doubles as recency.
 * This is what makes eviction least-recently-USED rather than oldest-fetched:
 * a key the UI keeps reading survives however old its data is.
 */
function touch(path: string, entry: Entry) {
  store.delete(path);
  store.set(path, entry);
}

/**
 * Drop the least recently used entries once the cache is over its cap.
 *
 * Two kinds are never evicted: one with a live subscriber (it is on screen now,
 * and dropping it would blank a rendered table) and one with a request in
 * flight (its promise is what a concurrent caller is already awaiting).
 */
function evictIfCrowded() {
  if (store.size <= MAX_ENTRIES) return;
  for (const [key, entry] of store) {
    if (store.size <= MAX_ENTRIES) break;
    if ((subs.get(key)?.size ?? 0) > 0 || entry.promise) continue;
    store.delete(key);
  }
}

/** Fetch through the cache. Returns cached data unless `force`, then refreshes. */
export async function cachedGet<T>(path: string, force = false): Promise<T> {
  const e = store.get(path);
  if (!force && e && e.data !== undefined) {
    touch(path, e);
    return e.data as T;
  }
  if (e?.promise) return e.promise as Promise<T>;

  const promise = api
    .get<T>(path)
    .then((data) => {
      store.set(path, { data, ts: Date.now() });
      evictIfCrowded();
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

/**
 * Server-side cap on one page (spring.data.web.pageable.max-page-size).
 *
 * Must match that setting. It sat at 500 while the server allowed 2000, so
 * every full read asked for four times as many pages as it needed to.
 */
const MAX_PAGE_SIZE = 2000;

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
/**
 * Most pages this will ever request, and how many at a time.
 *
 * The remaining pages used to go out in ONE `Promise.all`, so a large workspace
 * fired every page at once - concurrent scans against a connection pool of
 * eight, from a single browser, on every debounced keystroke. Six at a time
 * keeps the wall clock close to the parallel version while leaving the pool room
 * to serve everyone else. It matters less now that a page holds 2,000 rows and
 * most workspaces fit in one or two, but the cap is what makes that true rather
 * than lucky.
 *
 * The page cap is a guard rail, not a feature: nothing in the product is meant
 * to display 10,000 rows at once, and quietly truncating is better than the
 * browser stalling on a dataset it cannot render. It is logged when it bites so
 * a real workspace outgrowing it is visible rather than silent.
 */
const MAX_PAGES = 20;
const PAGE_CONCURRENCY = 6;

export async function cachedGetAll<T>(path: string, force = false): Promise<T[]> {
  const url = (page: number) =>
    `${path}${path.includes("?") ? "&" : "?"}page=${page}&size=${MAX_PAGE_SIZE}`;

  const first = await cachedGet<Page<T>>(url(0), force);
  if (first.total_pages <= 1) return first.content;

  const pages = Math.min(first.total_pages, MAX_PAGES);
  if (first.total_pages > MAX_PAGES) {
    console.warn(
      `cachedGetAll: ${path} has ${first.total_pages} pages; reading the first ${MAX_PAGES}. ` +
        "This view needs server-side filtering rather than a full download.",
    );
  }

  const rest: Page<T>[] = [];
  for (let from = 1; from < pages; from += PAGE_CONCURRENCY) {
    const batch = Array.from(
      { length: Math.min(PAGE_CONCURRENCY, pages - from) },
      (_, i) => cachedGet<Page<T>>(url(from + i), force),
    );
    rest.push(...(await Promise.all(batch)));
  }
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
