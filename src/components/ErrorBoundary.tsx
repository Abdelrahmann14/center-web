import { Component, type ReactNode } from "react";

/**
 * A render error anywhere below here used to blank the whole app to white: React
 * unmounts the tree on an uncaught error and there was no boundary to catch it.
 * Now the tree is caught and a recover screen shown instead.
 *
 * <p>The most common cause in production is a STALE CHUNK: a new build ships new
 * hashed chunk names, and a tab still holding the old page (or the old
 * index.html) asks for a chunk that no longer exists, so the dynamic import
 * rejects. That is not a real fault - the fix is simply to load the fresh build -
 * so that one case reloads itself once (guarded so a genuine boot failure cannot
 * loop), and everything else shows a button.
 */
const RELOAD_AT = "cn:chunk-reloaded-at";
// Long enough that a fresh build loads cleanly on the retry, short enough that a
// stale chunk hit again minutes later still self-heals. A genuine boot failure
// re-crashes within this window, so the second time we show the button instead
// of looping.
const RELOAD_COOLDOWN_MS = 15000;

function isChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /ChunkLoadError|Loading chunk|dynamically imported module|module script failed|Failed to fetch/i.test(
    msg,
  );
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // A fresh deploy invalidated a chunk this tab still references. Reload to
    // pick up the new build - but only if we did not just reload, so a genuine
    // failure that re-crashes immediately falls through to the button.
    if (!isChunkError(error)) return;
    const last = Number(sessionStorage.getItem(RELOAD_AT) || 0);
    if (Date.now() - last > RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(RELOAD_AT, String(Date.now()));
      window.location.reload();
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-lg font-bold text-slate-800">حدث خطأ غير متوقع</p>
        <p className="max-w-sm text-sm leading-6 text-slate-500">
          تعذّر عرض الصفحة. جرّب إعادة التحميل، وإن استمرت المشكلة أعد فتح التطبيق.
        </p>
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem(RELOAD_AT);
            window.location.reload();
          }}
          className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover"
        >
          إعادة التحميل
        </button>
      </div>
    );
  }
}
