import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { BellRing } from "@/components/icons";
import { api } from "@/lib/api";
import { Modal } from "@/components/ui";

interface Notif {
  id: string;
  sender: string;
  /**
   * What raised it. "chat" is somebody writing to the centre on WhatsApp, which
   * is what this bell is now mostly for; "whatsapp" is the platform reporting
   * that one of the numbers stopped working.
   */
  type: string;
  title: string | null;
  body: string;
  /** Where it leads. For "chat" this is the conversation. */
  link_id: string | null;
  read: boolean;
  created_at: string;
}

/**
 * Where a notification takes you, or null when it goes nowhere.
 *
 * <p>Only the ones that can actually be acted on are links. A row that looked
 * clickable and then did nothing would teach the reader to stop clicking the
 * ones that work.
 */
function destination(n: Notif): string | null {
  return n.type === "chat" && n.link_id ? `/messages?c=${n.link_id}` : null;
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });

/**
 * The inbox bell that lives in the sidebar header, beside the logo. Consumes
 * `/api/notifications` (every role has an inbox), so the admin receives the super
 * admin's broadcasts and assistants receive the admin's. The panel is portalled
 * to <body> and fixed-positioned because the sidebar clips overflow.
 *
 * The panel is a preview (bodies clamped); "عرض" opens the full inbox centered
 * on screen, where every message is shown in full.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [items, setItems] = useState<Notif[] | null>(null);
  /**
   * Where the panel sits, in viewport coordinates.
   *
   * <p>Anchored on ONE edge - `top` when it hangs below the bell, `bottom` when
   * it has flipped above it - never both, so the panel keeps its natural height
   * up to `maxHeight` instead of being stretched between two anchors.
   */
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    maxHeight: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  async function loadCount() {
    try {
      const r = await api.get<{ count: number }>("/notifications/unread-count");
      setCount(r.count);
    } catch {
      /* transient */
    }
  }

  useEffect(() => {
    loadCount();
    const t = setInterval(() => {
      if (!document.hidden) void loadCount();
    }, 30000);
    // Coming back to the tab is the moment somebody wants to know what they
    // missed; waiting out the rest of the interval is the wrong answer.
    const onVisible = () => {
      if (!document.hidden) void loadCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  /**
   * Fetches the inbox. Reading the inbox IS opening it: the badge clears without
   * making the user click every row, while the rows keep their "new" tint here.
   */
  async function loadItems() {
    setItems(null);
    try {
      const list = await api.get<Notif[]>("/notifications");
      setItems(list);
      if (list.some((n) => !n.read)) {
        api.post("/notifications/read-all").catch(() => {});
        setCount(0);
      }
    } catch {
      setItems([]);
    }
  }

  /**
   * Place the panel so it always fits on screen.
   *
   * <p>It used to be pinned at {@code bell.bottom + 10} with a fixed 24rem list
   * under it and nothing measuring the viewport, so on a short window - or with
   * the bell sitting low in the sidebar - the panel simply ran off the bottom of
   * the screen and the notifications underneath were unreachable: the page
   * itself does not scroll, and a fixed element cannot be scrolled to.
   *
   * <p>So the room below is measured, and the panel is told how tall it may be.
   * It flips above the bell only when below is genuinely cramped AND above is
   * roomier - flipping for a few pixels' gain would make the panel jump sides
   * for no benefit. `right` is clamped so a bell near the screen edge cannot
   * push the panel off it either.
   */
  function place() {
    if (!btnRef.current) return;
    const GAP = 10;
    const MARGIN = 12;
    const r = btnRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const flip = below < 240 && above > below;
    setPos({
      top: flip ? undefined : r.bottom + GAP,
      bottom: flip ? window.innerHeight - r.top + GAP : undefined,
      right: Math.max(MARGIN, window.innerWidth - r.right),
      // Never below a usable height: on a very short window the panel scrolls
      // internally rather than collapsing to a sliver.
      maxHeight: Math.max(200, flip ? above : below),
    });
  }

  // The bell moves with the layout, so a resized window (or a rotated phone)
  // would otherwise leave the panel pinned where the bell used to be.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  async function toggle() {
    const next = !open;
    if (next) place();
    setOpen(next);
    if (next) await loadItems();
  }

  function openAll() {
    setOpen(false);
    setShowAll(true);
    if (items === null) loadItems();
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title="الإشعارات"
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white"
      >
        <BellRing className="h-5 w-5" />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {count > 99 ? "99+" : count.toLocaleString("ar-EG")}
          </span>
        )}
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: pos.top,
              bottom: pos.bottom,
              right: pos.right,
              width: 320,
              maxHeight: pos.maxHeight,
            }}
            className="z-50 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-right shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <span className="font-bold text-slate-800">الإشعارات</span>
              <button
                onClick={openAll}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-accent transition hover:bg-accent/10"
              >
                عرض
              </button>
            </div>
            {/* min-h-0 is what lets this shrink inside the flex column - without
                it the list keeps its content height and pushes the panel past
                the maxHeight the placement just worked out. */}
            <div className="min-h-0 flex-1 overflow-auto">
              {items === null ? (
                <div className="p-6 text-center text-sm text-slate-400">جارٍ التحميل…</div>
              ) : items.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-400">لا توجد إشعارات</div>
              ) : (
                items.map((n) => (
                  <div
                    key={n.id}
                    role={destination(n) ? "button" : undefined}
                    tabIndex={destination(n) ? 0 : undefined}
                    onClick={() => {
                      const to = destination(n);
                      if (!to) return;
                      setOpen(false);
                      navigate(to);
                    }}
                    className={`flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-right ${
                      n.read ? "" : "bg-accent/5"
                    } ${destination(n) ? "cursor-pointer transition hover:bg-slate-50" : ""}`}
                  >
                    <Avatar />
                    <div className="min-w-0 flex-1">
                      {/* Title row: unread dot is pinned opposite the title so a
                          long title truncates instead of shoving it out. */}
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate font-semibold text-slate-800">
                          {n.title || n.sender}
                        </span>
                        {!n.read && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-3 text-sm leading-relaxed text-slate-600">
                        {n.body}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
                        {/* The sender only when it adds something. On a chat row
                            it IS the title, and printing it twice made every row
                            look like it had said the name for a reason. */}
                        {n.sender && n.sender !== (n.title || n.sender) && (
                          <>
                            <span className="truncate">{n.sender}</span>
                            <span className="text-slate-300">·</span>
                          </>
                        )}
                        <span className="shrink-0" dir="ltr">{fmt(n.created_at)}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}

      {showAll && (
        <Modal
          size="2xl"
          title="الإشعارات"
          subtitle={items && items.length > 0 ? `${items.length.toLocaleString("ar-EG")} رسالة` : undefined}
          onClose={() => setShowAll(false)}
          footer={
            <button
              onClick={() => setShowAll(false)}
              className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
            >
              إغلاق
            </button>
          }
        >
          {items === null ? (
            <div className="py-10 text-center text-sm text-slate-400">جارٍ التحميل…</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              <BellRing className="mx-auto mb-2 h-10 w-10 text-slate-300" />
              لا توجد إشعارات
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((n) => (
                <article
                  key={n.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-right"
                >
                  <Avatar />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-bold text-slate-800">{n.title || n.sender}</span>
                      <span className="text-xs text-slate-400">{n.sender}</span>
                      <span className="text-xs text-slate-300">·</span>
                      <span className="text-xs text-slate-400" dir="ltr">{fmt(n.created_at)}</span>
                    </div>
                    {/* Full body here - the panel clamps, this view never does. */}
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                      {n.body}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

// Every inbox row now comes from the platform itself, so there is no sender
// account behind it and no photo to show - just the bell mark.
function Avatar() {
  return (
    <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/10 text-accent">
      <BellRing className="h-4 w-4" />
    </span>
  );
}
