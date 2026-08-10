// Per-page UI state that survives navigation.
//
// React Router unmounts a page when you leave it, so plain useState is lost.
// `usePageState` mirrors useState but persists the value in a module-level map
// keyed by a stable string, so returning to a page restores exactly what the
// user left - search text, filters, selections, expanded panels, etc.
//
// In-memory only (cleared on full app reload). Pair with the scroll restorer in
// DashboardLayout for full "return as you left it" behaviour.

import { useCallback, useState } from "react";

const store = new Map<string, unknown>();

export function usePageState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() =>
    store.has(key) ? (store.get(key) as T) : initial
  );

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        store.set(key, resolved);
        return resolved;
      });
    },
    [key]
  );

  return [value, set] as const;
}

/** Forget stored page state. No prefix = clear all (e.g. on logout). */
export function clearPageState(prefix?: string) {
  if (!prefix) return store.clear();
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

// ── Scroll position per route ──
const scrollStore = new Map<string, number>();
export const saveScroll = (key: string, top: number) => scrollStore.set(key, top);
export const getScroll = (key: string) => scrollStore.get(key) ?? 0;
