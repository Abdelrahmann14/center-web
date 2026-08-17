// The NetworkMonitor port over the browser's connectivity signals. `navigator.
// onLine` plus the window `online`/`offline` events is all Chrome gives us - it
// reports the OS link state, not whether our server is reachable, so a pass can
// still fail on a live-but-useless connection. That is fine: the engine treats a
// failed pass as a retry-with-backoff, and a real disconnect flips this to
// offline and pauses the passes entirely.
import type { NetworkMonitor } from "@center/core";

export class BrowserNetworkMonitor implements NetworkMonitor {
  isOnline(): boolean {
    // Default to online when the API is missing rather than stranding writes.
    return typeof navigator === "undefined" ? true : navigator.onLine;
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
