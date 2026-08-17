import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Smile } from "@/components/icons";
import { inputClass } from "@/components/ui";
import { EMOJI_GROUPS, type Emoji } from "@/data/emoji";

/**
 * A text input with the full emoji set attached.
 *
 * <p>Typing already accepts anything the keyboard can produce - Arabic, Latin,
 * digits. What a keyboard cannot reach is an emoji, so the palette carries every
 * fully-qualified emoji Unicode defines (skin-tone and gender variants
 * included), grouped the way Unicode groups them, and inserts at the caret
 * rather than appending so a mark can be built up in any order.
 *
 * <p>The glyphs are bundled data rendered in the system font - no picker
 * library, and no images fetched from anywhere, so it works with no connection.
 * At this size the grid is windowed and the search is what actually finds
 * things; browsing four thousand cells is not a way to pick one.
 */

/** Cells per row. The panel width is derived from this. */
const COLUMNS = 8;
/** Fixed row height, which is what lets the grid be windowed cheaply. */
const ROW_H = 36;
/** Rows drawn beyond the viewport, so a fast scroll does not show gaps. */
const OVERSCAN = 4;
const VIEW_H = 260;

/**
 * A flat, case-folded index over every group, built once on first search.
 *
 * <p>381 of the names carry capitals ("flag: Egypt"), so matching the raw name
 * against a lowered query silently loses every flag. Folding once here beats
 * folding four thousand names on each keystroke.
 */
let SEARCH_INDEX: Emoji[] | null = null;
function searchIndex(): Emoji[] {
  if (SEARCH_INDEX === null) {
    SEARCH_INDEX = EMOJI_GROUPS.flatMap((g) =>
      g.items.map(([glyph, name]) => [glyph, name.toLowerCase()] as Emoji)
    );
  }
  return SEARCH_INDEX;
}

export function EmojiInput({
  value,
  onChange,
  placeholder,
  maxLength,
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [group, setGroup] = useState(0);
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  // Where the caret was when focus left the input for the palette.
  const caret = useRef<number | null>(null);

  // Search spans every group; with no query the active tab is the source.
  const items: readonly Emoji[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMOJI_GROUPS[group].items;
    return searchIndex().filter((item) => item[1].includes(q));
  }, [group, query]);

  const rows = Math.ceil(items.length / COLUMNS);
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const lastRow = Math.min(rows, Math.ceil((scrollTop + VIEW_H) / ROW_H) + OVERSCAN);

  // Switching tab or query starts the list from the top again.
  useEffect(() => {
    setScrollTop(0);
    if (gridRef.current) gridRef.current.scrollTop = 0;
  }, [group, query]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      setQuery("");
      setGroup(0);
    }
  }, [open]);

  /** Anchor under the button, clamped into the viewport on both axes. */
  const place = useCallback(() => {
    const anchor = btnRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!anchor || !panel) return;

    const margin = 8;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;

    let left = anchor.right - w;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - w - margin));

    let top = anchor.bottom + margin;
    if (top + h > window.innerHeight - margin) {
      const above = anchor.top - h - margin;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - h - margin);
    }
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    /**
     * The palette scrolls itself, and a capture-phase listener sees that inner
     * scroll too. Closing on it made the palette vanish the moment you scrolled
     * to reach an emoji. Scrolling inside is ignored; scrolling the page behind
     * it just moves the palette back under its button.
     */
    function onScroll(e: Event) {
      if (panelRef.current?.contains(e.target as Node)) return;
      place();
    }
    const reflow = () => place();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  function insert(glyph: string) {
    const el = inputRef.current;
    const at = caret.current ?? el?.selectionStart ?? value.length;
    const next = value.slice(0, at) + glyph + value.slice(at);
    if (maxLength !== undefined && next.length > maxLength) return;
    onChange(next);
    // Put the caret after what was just inserted, so a second pick lands beside
    // the first instead of jumping back.
    const after = at + glyph.length;
    caret.current = after;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(after, after);
    });
  }

  const remember = () => {
    caret.current = inputRef.current?.selectionStart ?? null;
  };

  return (
    <>
      <div className="relative">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onSelect={remember}
          onKeyUp={remember}
          onClick={remember}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={`${inputClass} pl-10 ${className}`}
        />
        <button
          ref={btnRef}
          type="button"
          title="إدراج رمز تعبيري"
          aria-label="إدراج رمز تعبيري"
          onMouseDown={(e) => {
            // Keep the caret: focus must not leave the input on mouse-down.
            e.preventDefault();
            remember();
          }}
          onClick={() => setOpen((o) => !o)}
          className={`absolute left-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg transition ${
            open ? "bg-accent/10 text-accent" : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          }`}
        >
          <Smile className="h-4 w-4" />
        </button>
      </div>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              // Rendered before it is placed so it can be measured; kept out of
              // sight for that one frame rather than flashing in the corner.
              visibility: pos ? "visible" : "hidden",
            }}
            className="z-[60] w-[21rem] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl animate-scale-up"
          >
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder="ابحث بالاسم الإنجليزي: heart, star, fire"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-9 pl-3 text-sm outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/30"
              />
            </div>

            {/* Tabs are hidden while searching: results already span every group. */}
            {!query.trim() && (
              <div className="mt-2 flex gap-0.5">
                {EMOJI_GROUPS.map((g, i) => (
                  <button
                    key={g.label}
                    type="button"
                    title={g.label}
                    aria-label={g.label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setGroup(i)}
                    className={`grid h-8 flex-1 place-items-center rounded-lg text-base transition ${
                      group === i ? "bg-accent/10" : "hover:bg-slate-100"
                    }`}
                  >
                    {g.icon}
                  </button>
                ))}
              </div>
            )}

            {/* Windowed: only the rows in view are in the DOM, so a group of
                two thousand glyphs scrolls as cheaply as one of eighty. */}
            <div
              ref={gridRef}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              className="no-scrollbar mt-2 overflow-y-auto"
              style={{ height: VIEW_H }}
            >
              {items.length === 0 ? (
                <p className="py-16 text-center text-sm text-slate-400">لا توجد نتائج</p>
              ) : (
                <div style={{ height: rows * ROW_H, position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      top: firstRow * ROW_H,
                      insetInline: 0,
                      display: "grid",
                      gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
                    }}
                  >
                    {items.slice(firstRow * COLUMNS, lastRow * COLUMNS).map(([glyph, name], i) => (
                      <button
                        key={`${glyph}-${firstRow * COLUMNS + i}`}
                        type="button"
                        title={name}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insert(glyph)}
                        className="grid place-items-center rounded-lg text-xl leading-none transition hover:bg-slate-100"
                        style={{ height: ROW_H }}
                      >
                        {glyph}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <p className="mt-1 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
              يمكنك أيضاً كتابة أي حروف أو أرقام مباشرة في الحقل.
            </p>
          </div>,
          document.body
        )}
    </>
  );
}
