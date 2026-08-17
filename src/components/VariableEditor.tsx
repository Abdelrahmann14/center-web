import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AtSign, Bold, Smile, X } from "@/components/icons";

/**
 * A message field where a variable is a CHIP, not a placeholder.
 *
 * <p>The old editor showed the author `{student.name}` and asked them to trust
 * it. That is a storage token wearing a UI, and it reads as broken to anyone who
 * has not been told the trick - people typed around it, deleted half of it, and
 * wrote the braces by hand in the wrong places. Here the same token renders as a
 * single solid chip reading "اسم الطالب": one object to the caret, impossible to
 * half-delete, and self-explanatory without a legend.
 *
 * <p>The stored value is unchanged - still `{key}` tokens - so every message
 * written before this still opens, and the server renders both identically. Only
 * what the author sees is different, which was the whole problem.
 *
 * <p>Anything in braces that is NOT a known variable stays literal text: the
 * message format uses `{...}` for WhatsApp bold too, and silently swallowing an
 * author's emphasis into an unknown-variable chip would lose their words.
 */

export interface MessageVariable {
  key: string;
  /** The two or three plain words the chip shows. */
  label: string;
  description: string;
  group: string;
  example?: string;
}

const CHIP_CLASS =
  "mx-0.5 inline-flex select-none items-center rounded-md bg-accent/12 px-1.5 py-0.5 align-baseline " +
  "text-[0.8125rem] font-semibold leading-5 text-accent ring-1 ring-inset ring-accent/25";

// A small offline set of message-friendly emojis - no external picker, so it
// keeps working with no network.
const EMOJIS = [
  "😀", "😊", "😍", "🙌", "👏", "👍", "🙏", "🤝", "❤️", "💪",
  "🔥", "💯", "⭐", "🎉", "🏆", "🎓", "📚", "📝", "📌", "📢",
  "🔔", "🗓️", "⏰", "📞", "✅", "❌", "⚠️", "❗", "💰", "➡️",
];

/**
 * A zero-width space. Used to give a trailing line break something to hold, and
 * stripped again on the way out so it never reaches the message.
 */
const ZWSP = "​";

/** Tallest the variable picker gets before it scrolls its own list. */
const MAX_PICKER_H = 288;

/**
 * Place a floating panel under something, in viewport coordinates.
 *
 * <p>Both panels in this editor are drawn on document.body rather than in the
 * flow, because the flow here is an automation card with `overflow-hidden` and
 * an animated height - it clipped whichever panel opened inside it. Off the
 * body the only boundary left is the window, which this keeps them inside: it
 * flips the panel above its anchor when the space below cannot hold it, and
 * pulls it back from either edge.
 *
 * <p>Right-aligned to the anchor because the app reads right-to-left.
 */
function placeUnder(anchor: DOMRect, width: number, height: number): CSSProperties {
  const GAP = 6;
  const EDGE = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(width, vw - EDGE * 2);
  const left = Math.min(Math.max(EDGE, anchor.right - w), vw - w - EDGE);
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - height;
  const top = below + height <= vh - EDGE ? below : Math.max(EDGE, above);
  return { position: "fixed", top, left, width: w };
}

/**
 * Keep `style` pointing at whatever `anchor()` returns for as long as `open`.
 *
 * <p>The second pass on the next frame is what makes the flip honest: on the
 * first pass the panel is not in the DOM yet, so its height can only be
 * guessed, and a guess that is too tall flips a panel that would have fitted.
 * By the frame after, it can be measured for real.
 */
function useFloating(
  open: boolean,
  anchor: () => DOMRect | null,
  width: number,
  fallbackHeight: number,
  panelRef: React.RefObject<HTMLDivElement | null>,
  deps: unknown[],
) {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const place = () => {
      const rect = anchor();
      if (!rect) return;
      setStyle(placeUnder(rect, width, panelRef.current?.offsetHeight || fallbackHeight));
    };
    place();
    const frame = requestAnimationFrame(place);
    // Capture phase: the card and the modal body are their own scroll
    // containers, and their scroll never reaches the window in the bubble phase.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, width, fallbackHeight, ...deps]);

  return style;
}

/** Build one chip element for a variable. */
function chipNode(v: MessageVariable): HTMLSpanElement {
  const el = document.createElement("span");
  el.dataset.var = v.key;
  el.contentEditable = "false";
  el.className = CHIP_CLASS;
  el.textContent = v.label;
  el.title = v.example ? `${v.description} - مثال: ${v.example}` : v.description;
  return el;
}

/**
 * Read the editor back out as the stored string: a chip becomes `{key}`, a line
 * break becomes a newline, everything else is its own text.
 */
function serialize(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.var) {
      out += `{${node.dataset.var}}`;
      return;
    }
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    // Chrome wraps pasted or Enter-split content in DIV/P even when we ask it
    // not to; treat the boundary as the line break the author sees.
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && out && !out.endsWith("\n")) out += "\n";
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  // Both of these are the browser's own bookkeeping, not the author's text:
  // a non-breaking space keeps a caret position alive, and the zero-width
  // space is the filler we put after a trailing line break.
  return out.replace(/ /g, " ").replace(/​/g, "");
}

/** Rebuild the editor's DOM from a stored string. */
function paint(root: HTMLElement, value: string, byKey: Map<string, MessageVariable>) {
  const frag = document.createDocumentFragment();
  const pushText = (text: string) => {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (i) frag.appendChild(document.createElement("br"));
      if (line) frag.appendChild(document.createTextNode(line));
    });
  };
  const re = /\{([^{}]*)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    pushText(value.slice(last, m.index));
    const known = byKey.get(m[1]);
    if (known) frag.appendChild(chipNode(known));
    else pushText(m[0]);
    last = re.lastIndex;
  }
  pushText(value.slice(last));
  root.replaceChildren(frag);
}

/** Put the caret at the very end of the editor. */
function caretToEnd(root: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function VariableEditor({
  value,
  onChange,
  variables,
  rows = 5,
  placeholder,
  disabled,
  maxLength = 2000,
  leading,
  fieldTint,
}: {
  value: string;
  onChange: (v: string) => void;
  variables: MessageVariable[];
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  /**
   * Controls that belong to this field and share its one chrome line - the
   * field's own settings sit at the start of the row, the writing tools at the
   * end, and nothing costs a second line.
   */
  leading?: React.ReactNode;
  /** Background class for the writing surface itself (defaults to white). */
  fieldTint?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const emojiPanelRef = useRef<HTMLDivElement>(null);
  // What we last handed upwards. The editor only repaints when the incoming
  // value differs from this, because repainting destroys the caret and a
  // repaint on every keystroke would send it to the end of the field.
  const emitted = useRef<string>(value);
  const savedRange = useRef<Range | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Set while the author is typing an "@..." mention, so picking from the list
  // knows how many characters to swallow.
  const mention = useRef<number>(0);

  const byKey = useMemo(() => new Map(variables.map((v) => [v.key, v])), [variables]);

  useEffect(() => {
    const root = ref.current;
    if (!root || value === emitted.current) return;
    // The value changed from OUTSIDE (a template was loaded, the form reset).
    // Repainting throws the caret away, so put it back at the end - but only if
    // the field had focus, or we would steal it from wherever the user is.
    const focused = document.activeElement === root;
    paint(root, value, byKey);
    emitted.current = value;
    if (focused) caretToEnd(root);
  }, [value, byKey]);

  // The catalog can arrive after the first paint (it is fetched); repaint once
  // it does, or the tokens sit there as literal braces.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    paint(root, emitted.current, byKey);
  }, [byKey]);

  function emit() {
    const root = ref.current;
    if (!root) return;
    let next = serialize(root);
    if (next.length > maxLength) next = next.slice(0, maxLength);
    emitted.current = next;
    onChange(next);
  }

  function rememberCaret() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ref.current?.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }

  // Declared above the placement effect below, which needs to know how many
  // groups there are to decide when the panel's height has changed.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = variables.filter(
      (v) => !q || v.label.toLowerCase().includes(q) || v.description.toLowerCase().includes(q),
    );
    const out = new Map<string, MessageVariable[]>();
    for (const v of matches) {
      const list = out.get(v.group) ?? [];
      list.push(v);
      out.set(v.group, list);
    }
    return [...out.entries()];
  }, [variables, query]);

  /**
   * Where the caret is on screen, so the picker can open next to it.
   *
   * <p>Falls back to the saved range (the toolbar buttons block focus rather than
   * take it, so the live selection may have moved on), and then to the field
   * itself for an empty editor - a collapsed range in a container with no text
   * measures 0x0 and would place the panel in the corner of the screen.
   */
  function caretRect(): DOMRect | null {
    const root = ref.current;
    if (!root) return null;
    const sel = window.getSelection();
    let range: Range | null = null;
    if (sel && sel.rangeCount) {
      const live = sel.getRangeAt(0);
      if (root.contains(live.commonAncestorContainer)) range = live.cloneRange();
    }
    if (!range && savedRange.current && root.contains(savedRange.current.commonAncestorContainer)) {
      range = savedRange.current.cloneRange();
    }
    if (range) {
      range.collapse(true);
      const rect = range.getBoundingClientRect();
      if (rect.height) return rect;
    }
    return root.getBoundingClientRect();
  }

  // The variable list follows the caret: it is answering "what goes HERE", so it
  // belongs beside the word being typed, not under the whole field. Re-placed on
  // every keystroke (the caret moved) and whenever filtering resizes the list.
  const pickerStyle = useFloating(pickerOpen, caretRect, 352, MAX_PICKER_H, panelRef, [
    query,
    groups.length,
  ]);

  // The emoji grid is a toolbar popover, so it hangs off its own button instead.
  const emojiStyle = useFloating(
    emojiOpen,
    () => emojiBtnRef.current?.getBoundingClientRect() ?? null,
    240,
    160,
    emojiPanelRef,
    [],
  );

  // Clicking anywhere else closes them. The panels are portalled, so they are
  // not descendants of this component - both places have to be tested.
  useEffect(() => {
    if (!pickerOpen && !emojiOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t) || emojiPanelRef.current?.contains(t)) return;
      setPickerOpen(false);
      setEmojiOpen(false);
      mention.current = 0;
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen, emojiOpen]);

  /** The plain text between the start of the field and the caret. */
  function textBeforeCaret(): string {
    const root = ref.current;
    const sel = window.getSelection();
    if (!root || !sel || !sel.rangeCount) return "";
    const r = sel.getRangeAt(0).cloneRange();
    r.setStart(root, 0);
    return r.toString();
  }

  function syncMention() {
    const before = textBeforeCaret();
    const m = before.match(/@([\p{L}\w.\s]{0,20})$/u);
    if (m) {
      mention.current = m[0].length;
      setQuery(m[1]);
      setPickerOpen(true);
    } else if (mention.current) {
      mention.current = 0;
      setQuery("");
      setPickerOpen(false);
    }
  }

  /** Remove the n characters immediately before the caret (the "@query"). */
  function dropBeforeCaret(n: number) {
    if (n <= 0) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (r.startContainer.nodeType !== Node.TEXT_NODE) return;
    const start = Math.max(0, r.startOffset - n);
    r.setStart(r.startContainer, start);
    r.deleteContents();
    r.collapse(true);
  }

  function insertNodes(nodes: Node[]) {
    const root = ref.current;
    if (!root || disabled) return;
    root.focus();
    const sel = window.getSelection();
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    if (!range || !root.contains(range.commonAncestorContainer)) {
      range = savedRange.current && root.contains(savedRange.current.commonAncestorContainer)
        ? savedRange.current
        : null;
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(root);
      range.collapse(false);
    }
    sel?.removeAllRanges();
    sel?.addRange(range);
    range.deleteContents();
    if (mention.current) {
      dropBeforeCaret(mention.current);
      mention.current = 0;
    }
    let anchor: Node | null = null;
    for (const node of nodes) {
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      anchor = node;
    }
    if (anchor) {
      const after = document.createRange();
      after.setStartAfter(anchor);
      after.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(after);
    }
    emit();
    rememberCaret();
  }

  function pick(v: MessageVariable) {
    setPickerOpen(false);
    setQuery("");
    insertNodes([chipNode(v), document.createTextNode(" ")]);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && pickerOpen) {
      e.preventDefault();
      setPickerOpen(false);
      mention.current = 0;
      return;
    }
    if (e.key === "Enter") {
      // Keep the structure flat: our own <br> instead of Chrome's <div> wrapper.
      // The zero-width space after it is the standard trick for a <br> that lands
      // last - browsers do not render a trailing line break, so without something
      // occupying the new line the caret appears not to have moved. It is stripped
      // on the way back out, so it never reaches the message.
      e.preventDefault();
      insertNodes([document.createElement("br"), document.createTextNode(ZWSP)]);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      insertNodes([document.createTextNode("{}")]);
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // Paste as plain text: foreign markup in a contenteditable is how these
    // fields end up carrying invisible styling nobody asked for.
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (text) insertNodes([document.createTextNode(text)]);
  }

  // One line of chrome: the field's own settings first, the writing tools last.
  const tools = (
    <div className="mb-1.5 flex flex-wrap items-center gap-2">
        {leading}
        <div className="ms-auto flex items-center gap-1.5">
        <button
          type="button"
          disabled={disabled}
          title="إضافة معلومة"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setEmojiOpen(false);
            setQuery("");
            mention.current = 0;
            setPickerOpen((o) => !o);
          }}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
            pickerOpen
              ? "border-accent bg-accent/10 text-accent"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
          }`}
        >
          <AtSign className="h-3.5 w-3.5" />
          إضافة معلومة
        </button>
        <button
          type="button"
          disabled={disabled}
          title="نص عريض"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insertNodes([document.createTextNode("{}")])}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
        >
          <Bold className="h-4 w-4" />
        </button>
        <div>
          <button
            ref={emojiBtnRef}
            type="button"
            disabled={disabled}
            title="إيموجي"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setPickerOpen(false);
              setEmojiOpen((o) => !o);
            }}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border transition disabled:opacity-50 ${
              emojiOpen
                ? "border-accent bg-accent/10 text-accent"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100"
            }`}
          >
            <Smile className="h-4 w-4" />
          </button>
          {emojiOpen && emojiStyle && createPortal(
            <div
              ref={emojiPanelRef}
              style={emojiStyle}
              dir="rtl"
              className="z-[70] grid grid-cols-8 gap-0.5 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl animate-fade-in"
            >
              {EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    insertNodes([document.createTextNode(em)]);
                    setEmojiOpen(false);
                  }}
                  className="rounded-md p-1 text-lg leading-none transition hover:bg-slate-100"
                >
                  {em}
                </button>
              ))}
            </div>,
            document.body,
          )}
        </div>
        </div>
    </div>
  );

  const field = (
      <div
        ref={ref}
        role="textbox"
        aria-multiline
        aria-label={placeholder}
        contentEditable={!disabled}
        suppressContentEditableWarning
        dir="auto"
        data-placeholder={placeholder ?? ""}
        style={{ minHeight: `${Math.max(1, rows) * 1.6 + 1.25}rem` }}
        onInput={() => {
          emit();
          syncMention();
        }}
        onKeyUp={rememberCaret}
        onMouseUp={rememberCaret}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={rememberCaret}
        className={`w-full whitespace-pre-wrap break-words rounded-md border border-slate-300 px-3.5 py-2.5 text-sm leading-6 text-slate-800 outline-none transition
          empty:before:pointer-events-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)]
          focus:border-accent focus:ring-2 focus:ring-accent/20
          ${disabled ? "cursor-not-allowed bg-slate-50 opacity-70" : fieldTint ?? "bg-white"}`}
      />
  );

  return (
    <div ref={wrapRef} className="relative">
      {tools}
      {field}

      {pickerOpen && pickerStyle && createPortal(
        // z-[70]: above the modal overlay (z-50) and above the portalled Select
        // menus (z-[60]). This is the layer the author is actively typing into,
        // so nothing may cover it.
        <div
          ref={panelRef}
          style={pickerStyle}
          dir="rtl"
          // max-h-72 is MAX_PICKER_H, which the placement assumes as the ceiling.
          className="z-[70] max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl animate-fade-in"
        >
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1">
            <span className="text-xs font-semibold text-slate-500">
              اختر المعلومة التي تريد إضافتها للرسالة
            </span>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPickerOpen(false)}
              className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {groups.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">لا توجد نتائج</p>
          )}
          {groups.map(([group, items]) => (
            <div key={group} className="mb-1">
              <p className="px-2 py-1 text-[11px] font-semibold text-slate-400">{group}</p>
              <div className="flex flex-wrap gap-1.5 px-1 pb-1">
                {items.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    title={v.example ? `${v.description} - مثال: ${v.example}` : v.description}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(v)}
                    className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-accent/15 hover:text-accent"
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>,
        document.body,
      )}

    </div>
  );
}
