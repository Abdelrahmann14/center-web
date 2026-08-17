import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { createPortal } from "react-dom";
import { Menu } from "@/components/icons";

export interface RowAction {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  onSelect: () => void;
  /** Greyed out and unclickable; say why in `title`. */
  disabled?: boolean;
  title?: string;
  /** Destructive: red text, and pushed under a divider. */
  danger?: boolean;
}

const MENU_WIDTH = 180;
const GAP = 4;

/**
 * One button per row instead of a strip of icons: the row's actions live in a
 * menu that names each one, so the column stays narrow and nothing has to be
 * guessed from a glyph.
 *
 * The menu is drawn in a portal, not inside the cell: a table that clips its
 * own overflow (so its corners stay rounded) would otherwise cut the popup off
 * at the edge of the frame.
 */
export function RowActionsMenu({ actions, label = "إجراءات" }: { actions: RowAction[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Anchored to the button's box on screen, flipped above it when the row sits
  // near the bottom of the window and clamped so it never leaves the viewport.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? actions.length * 38 + 8;
    const below = r.bottom + GAP;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - GAP - height) : below;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - MENU_WIDTH - 8);
    setPos({ top, left });
  }, [open, actions.length]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Any scroll moves the button out from under the menu, so the menu goes.
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const normal = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);

  const item = (a: RowAction) => (
    <button
      key={a.key}
      disabled={a.disabled}
      title={a.title}
      onClick={() => {
        setOpen(false);
        a.onSelect();
      }}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
        a.danger
          ? "text-rose-600 hover:bg-rose-50"
          : "text-slate-700 hover:bg-slate-100 hover:text-accent"
      }`}
    >
      <a.icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{a.label}</span>
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        title={label}
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`mx-auto flex rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent ${
          open ? "bg-accent/10 text-accent" : ""
        }`}
      >
        <Menu className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH }}
            className="fixed z-50 rounded-xl border border-slate-200 bg-white p-1 shadow-lg animate-fade-in"
          >
            {normal.map(item)}
            {danger.length > 0 && normal.length > 0 && <div className="my-1 h-px bg-slate-100" />}
            {danger.map(item)}
          </div>,
          document.body,
        )}
    </>
  );
}
