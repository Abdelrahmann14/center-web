// Connectivity from the browser: navigator.onLine plus the online/offline events.
import type { NetworkMonitor } from "@center/core";

export class BrowserNetworkMonitor implements NetworkMonitor {
  isOnline(): boolean {
    return navigator.onLine;
  }

  subscribe(listener: (online: boolean) => void): () => void {
    const onOnline = () => listener(true);
    const onOffline = () => listener(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }
}
