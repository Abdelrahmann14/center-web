import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bold, Smile, Link2, AtSign } from "lucide-react";

export interface Variable {
  key: string;
  description: string;
  group: string;
  /** Sample value shown in the tooltip so the author sees what it becomes. */
  example?: string;
}

// Shared box metrics so the highlight backdrop lines up under the textarea exactly.
const BOX = "w-full rounded-md px-3.5 py-2.5 text-sm leading-6";

// A small, offline (no external picker) set of message-friendly emojis.
const EMOJIS = [
  "😀", "😊", "😍", "😉", "😅", "🙌", "👏", "👍", "🙏", "🤝",
  "❤️", "💪", "🔥", "💯", "⭐", "🌟", "🎉", "🏆", "🎓", "📚",
  "✏️", "📝", "📌", "📍", "📢", "🔔", "🗓️", "⏰", "📞", "✉️",
  "✅", "❌", "⚠️", "❗", "❓", "💰", "➡️", "⬅️", "😢", "😡",
];

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MIRROR_PROPS = [
  "boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize", "fontFamily",
  "lineHeight", "letterSpacing", "wordSpacing", "tabSize", "textAlign", "direction",
] as const;

/** Pixel position of the caret inside a textarea (border-box relative). */
function caretCoords(el: HTMLTextAreaElement, pos: number) {
  const div = document.createElement("div");
  const computed = getComputedStyle(el);
  div.style.position = "absolute";
  div.style.top = "-9999px";
  div.style.left = "-9999px";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.overflow = "hidden";
  for (const p of MIRROR_PROPS) (div.style as any)[p] = (computed as any)[p];
  div.textContent = el.value.slice(0, pos);
  const marker = document.createElement("span");
  marker.textContent = el.value.slice(pos) || ".";
  div.appendChild(marker);
  document.body.appendChild(div);
  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  const height = parseInt(computed.lineHeight) || parseInt(computed.fontSize) || 20;
  document.body.removeChild(div);
  return { top, left, height };
}

// Any {…} renders bold; a known variable is also accent-colored.
function highlight(value: string, valid: Set<string>) {
  const html = esc(value).replace(/\{([^{}]*)\}/g, (_m, inner: string) => {
    const isValid = valid.has(inner);
    return `<strong class="font-bold ${isValid ? "text-accent" : "text-slate-800"}">{${inner}}</strong>`;
  });
  // Keep the backdrop height in step with a trailing newline in the textarea.
  return value.endsWith("\n") ? html + " " : html;
}

/**
 * A text field where {variables} render bold and typing "@" opens a variable
 * menu. A toolbar adds bold (wraps the selection in {…} - no manual braces),
 * emoji, link and variable buttons. Used for notification titles / bodies and
 * message templates. Single-line when `multiline` is false.
 */
export function VariableTextEditor({
  value,
  onChange,
  variables,
  multiline = true,
  placeholder,
  maxLength,
  rows = 5,
}: {
  value: string;
  onChange: (v: string) => void;
  variables: Variable[];
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const caretToSet = useRef<number | null>(null);
  // Last known selection, kept fresh so toolbar/popovers insert at the right spot
  // even after the textarea loses focus.
  const sel = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [menu, setMenu] = useState<{ query: string; at: number; top: number; left: number } | null>(null);
  const [active, setActive] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");

  const validKeys = useMemo(() => new Set(variables.map((v) => v.key)), [variables]);
  const html = useMemo(() => highlight(value, validKeys), [value, validKeys]);

  const usedVars = useMemo(() => {
    const found = new Set<string>();
    for (const m of value.matchAll(/\{([^{}]*)\}/g)) {
      if (validKeys.has(m[1])) found.add(m[1]);
    }
    return variables.filter((v) => found.has(v.key));
  }, [value, variables, validKeys]);

  const matches = useMemo(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    return variables.filter((v) => v.key.toLowerCase().includes(q) || v.description.includes(menu.query));
  }, [menu, variables]);

  useLayoutEffect(() => {
    if (caretToSet.current != null && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(caretToSet.current, caretToSet.current);
      sel.current = { start: caretToSet.current, end: caretToSet.current };
      caretToSet.current = null;
    }
  });

  useEffect(() => setActive(0), [menu?.query]);

  function trackSel(el: HTMLTextAreaElement) {
    sel.current = { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
  }

  function syncMenu(el: HTMLTextAreaElement) {
    trackSel(el);
    const caret = el.selectionStart ?? 0;
    const before = el.value.slice(0, caret);
    const m = before.match(/@([\p{L}\w.]*)$/u);
    if (!m) {
      setMenu(null);
      return;
    }
    const c = caretCoords(el, caret);
    const maxLeft = Math.max(4, el.clientWidth - 288);
    setMenu({
      query: m[1],
      at: caret - m[0].length,
      top: c.top - el.scrollTop + c.height + 4,
      left: Math.min(Math.max(4, c.left - el.scrollLeft), maxLeft),
    });
  }

  function pick(v: Variable) {
    if (!menu) return;
    const caret = sel.current.start;
    const token = `{${v.key}}`;
    const next = value.slice(0, menu.at) + token + value.slice(caret);
    caretToSet.current = menu.at + token.length;
    onChange(next);
    setMenu(null);
  }

  // Replace the current selection with prefix + selected + suffix. Empty selection
  // + a prefix/suffix pair leaves the caret between them (e.g. bold {|}).
  function wrap(prefix: string, suffix: string) {
    if (maxLength != null && value.length + prefix.length + suffix.length > maxLength) return;
    const { start, end } = sel.current;
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + prefix + selected + suffix + value.slice(end);
    caretToSet.current = selected
      ? start + prefix.length + selected.length + suffix.length
      : start + prefix.length;
    onChange(next);
  }

  function insert(text: string) {
    const { start, end } = sel.current;
    const clamped = maxLength != null ? text.slice(0, Math.max(0, maxLength - (value.length - (end - start)))) : text;
    const next = value.slice(0, start) + clamped + value.slice(end);
    caretToSet.current = start + clamped.length;
    onChange(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (menu && matches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(matches[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }
    // Ctrl/Cmd+B = bold, matching the toolbar button.
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      wrap("{", "}");
      return;
    }
    if (!multiline && e.key === "Enter") e.preventDefault();
  }

  return (
    <div className="relative">
      {/* Formatting toolbar */}
      <div className="mb-1.5 flex items-center gap-1">
        <ToolbarButton label="عريض (تحديد النص)" onClick={() => wrap("{", "}")}>
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <div className="relative">
          <ToolbarButton label="إدراج إيموجي" active={emojiOpen} onClick={() => { setEmojiOpen((o) => !o); setLinkOpen(false); }}>
            <Smile className="h-4 w-4" />
          </ToolbarButton>
          {emojiOpen && (
            <div className="absolute z-40 mt-1 grid w-64 grid-cols-8 gap-0.5 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  className="rounded-md p-1 text-lg leading-none transition hover:bg-slate-100"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { insert(em); setEmojiOpen(false); }}
                >
                  {em}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <ToolbarButton label="إدراج رابط" active={linkOpen} onClick={() => { setLinkOpen((o) => !o); setEmojiOpen(false); }}>
            <Link2 className="h-4 w-4" />
          </ToolbarButton>
          {linkOpen && (
            <div className="absolute z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                dir="ltr"
                placeholder="https://example.com"
                className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (linkUrl.trim()) { insert(linkUrl.trim()); }
                    setLinkUrl(""); setLinkOpen(false);
                  }
                }}
              />
              <div className="mt-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => { if (linkUrl.trim()) insert(linkUrl.trim()); setLinkUrl(""); setLinkOpen(false); }}
                  className="rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-accent-hover"
                >
                  إدراج
                </button>
              </div>
            </div>
          )}
        </div>
        <ToolbarButton
          label="إدراج متغيّر"
          onClick={() => {
            const el = ref.current;
            if (!el) return;
            el.focus();
            const { start } = sel.current;
            const next = value.slice(0, start) + "@" + value.slice(start);
            caretToSet.current = start + 1;
            onChange(next);
            setTimeout(() => { if (ref.current) syncMenu(ref.current); }, 0);
          }}
        >
          <AtSign className="h-4 w-4" />
        </ToolbarButton>
      </div>

      <div className="relative">
        <div
          ref={backdropRef}
          aria-hidden
          className={`${BOX} pointer-events-none absolute inset-0 overflow-hidden border border-transparent text-slate-800 ${
            multiline ? "whitespace-pre-wrap break-words" : "whitespace-pre overflow-x-hidden"
          }`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <textarea
          ref={ref}
          value={value}
          rows={multiline ? rows : 1}
          maxLength={maxLength}
          placeholder={placeholder}
          dir="auto"
          onChange={(e) => {
            onChange(e.target.value);
            syncMenu(e.target);
          }}
          onSelect={(e) => trackSel(e.currentTarget)}
          onKeyUp={(e) => syncMenu(e.currentTarget)}
          onClick={(e) => syncMenu(e.currentTarget)}
          onKeyDown={onKeyDown}
          onScroll={(e) => {
            if (backdropRef.current) {
              backdropRef.current.scrollTop = e.currentTarget.scrollTop;
              backdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          onBlur={() => setTimeout(() => setMenu(null), 150)}
          className={`${BOX} relative border border-slate-300 bg-transparent text-transparent caret-slate-800 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 ${
            multiline ? "resize-y" : "resize-none overflow-hidden"
          }`}
        />

        {menu && matches.length > 0 && (
          <div
            className="absolute z-30 max-h-56 w-72 overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg"
            style={{ top: menu.top, left: menu.left }}
          >
            {matches.map((v, i) => (
              <button
                key={v.key}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(v);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-right transition ${
                  i === active ? "bg-accent/10" : "hover:bg-slate-50"
                }`}
              >
                <span className="font-mono text-xs font-bold text-accent" dir="ltr">{`{${v.key}}`}</span>
                <span className="text-xs text-slate-500">{v.description}</span>
                {v.example && (
                  <span className="text-[11px] text-slate-400">
                    مثال: <span dir="auto">{v.example}</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-1 text-xs text-slate-400">
        اكتب <span className="font-mono font-bold text-slate-500">@</span> لإدراج متغيّر، أو حدّد النص واضغط
        زر العريض. مرّر فوق المتغيّر لمعرفة معناه ومثاله.
      </p>
      {usedVars.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {usedVars.map((v) => (
            <VarChip key={v.key} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition ${
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

// A used-variable chip with a hover tooltip explaining the placeholder + example.
function VarChip({ v }: { v: Variable }) {
  const [hover, setHover] = useState(false);
  return (
    <span
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        className="cursor-help rounded-md bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent"
        dir="ltr"
      >
        {`{${v.key}}`}
      </span>
      {hover && (
        <span className="absolute bottom-full right-0 z-50 mb-1 w-56 rounded-lg border border-slate-200 bg-white p-2 text-right shadow-lg">
          <span className="block text-xs font-semibold text-slate-700">{v.description}</span>
          {v.example && (
            <span className="mt-0.5 block text-[11px] text-slate-500">
              مثال: <span dir="auto">{v.example}</span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}
