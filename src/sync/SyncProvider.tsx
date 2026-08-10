// Wires the shared SyncEngine to the browser ports (IndexedDB + navigator) and
// exposes it to the dashboard. The local database is keyed to the current
// workspace owner, so a super admin switching act-as workspaces gets a fresh
// engine and store rather than mixing tenants.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SyncEngine, initialStatus, type SyncStatus } from "@center/core";
import { useAuth } from "@/auth/AuthContext";
import { WebSyncStore } from "./store";
import { BrowserNetworkMonitor } from "./network";
import { HttpSyncTransport } from "./transport";

interface SyncContextValue {
  status: SyncStatus;
  store: WebSyncStore | null;
  syncNow: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  // A super admin owns no workspace data and is skipped; everyone else syncs
  // their own workspace.
  const owner = user?.role === "super_admin" ? null : user?.id ?? null;

  const engineRef = useRef<SyncEngine | null>(null);
  const [store, setStore] = useState<WebSyncStore | null>(null);
  const [status, setStatus] = useState<SyncStatus>(initialStatus(navigator.onLine));

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    let engine: SyncEngine | null = null;

    (async () => {
      const localStore = await WebSyncStore.open(owner);
      if (cancelled) return;
      engine = new SyncEngine({
        store: localStore,
        transport: new HttpSyncTransport(),
        network: new BrowserNetworkMonitor(),
        onStatus: setStatus,
      });
      engineRef.current = engine;
      setStore(localStore);
      engine.start();
    })();

    return () => {
      cancelled = true;
      engine?.stop();
      engineRef.current = null;
      setStore(null);
    };
  }, [owner]);

  const value: SyncContextValue = {
    status,
    store,
    syncNow: () => engineRef.current?.sync(),
  };
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}
