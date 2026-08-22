import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock,
  Download,
  FileText,
  MessageCircle,
  MessageCircleOff,
  Search,
  Send,
  User,
} from "@/components/icons";
import { api, ApiError, getFile } from "@/lib/api";
import { arabicDigits } from "@/lib/datetime";
import { useDebounced } from "@/lib/useDebounced";
import { toast } from "@/components/ui/toast";
import { EmojiPickerButton } from "@/components/EmojiInput";
import { LoaderBlock } from "@/components/PencilLoader";

/**
 * «الرسائل» - the conversations, not the campaigns.
 *
 * <p>Everything else this product does with WhatsApp is one-way: a button is
 * pressed and a hundred parents are told something. This screen is the other
 * direction, and it is the ONLY place in the app where a person may write a
 * sentence of their own to a parent.
 *
 * <p>That is not a design choice, it is Meta's rule, and the whole screen is
 * built around it: a business may answer freely for 24 hours after the CUSTOMER
 * writes, and only with a pre-approved template outside that. So the composer is
 * a door that the other person opens - never the teacher - and when it is shut
 * the screen says so plainly instead of letting somebody type a paragraph that
 * WhatsApp will refuse.
 */

type Conversation = {
  id: string;
  phone: string;
  /** Roster name, else their WhatsApp profile name, else the bare number. */
  name: string;
  profile_name: string | null;
  student_id: string | null;
  student_name: string | null;
  student_code: string | null;
  contact_kind: "STUDENT" | "PARENT" | "UNKNOWN";
  last_message_at: string;
  last_inbound_at: string | null;
  last_direction: "IN" | "OUT";
  last_preview: string | null;
  unread: number;
  archived: boolean;
  /** Whether free text is still allowed. The composer obeys this and nothing else. */
  window_open: boolean;
  window_ends_at: string | null;
};

type Message = {
  id: string;
  direction: "IN" | "OUT";
  kind: string;
  body: string | null;
  has_media: boolean;
  media_mime: string | null;
  media_filename: string | null;
  status: "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "RECEIVED";
  failure_code: number | null;
  failure_reason: string | null;
  sent_by_name: string | null;
  /** The approved template this went out as. Null for anything a person typed. */
  template_name: string | null;
  occurred_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

const BASE = "/messaging/whatsapp/inbox";

/**
 * Which slice of the list is on screen.
 *
 * <p>"replied" exists because the system's own messages now open threads. That
 * is right - they are the same conversation on the parent's phone - but it means
 * a centre messaging four hundred parents a day has four hundred rows, and the
 * six people actually waiting for an answer are somewhere inside them. This is
 * the filter that gets them back: a thread somebody has WRITTEN into at least
 * once, which is the only thing separating a conversation from a delivery
 * record.
 */
type Scope = "all" | "replied" | "archived";

/**
 * WhatsApp's own colours, on purpose.
 *
 * <p>The rest of this product is teal-on-white and should stay that way. A chat
 * is the one screen where the reader already has thirty thousand hours of
 * practice somewhere else: mint on the right is mine, white on the left is
 * theirs, and the beige behind both is what tells a bubble from the page. Using
 * the house palette here meant two greys a shade apart, which is a puzzle, not a
 * conversation.
 *
 * <p>Hex rather than Tailwind steps because these are specific colours, not
 * points on a scale - `bg-green-100` is not #D9FDD3 and never will be.
 */
const WA = {
  /** The paper the conversation is written on. */
  canvas: "#EFEAE2",
  /** Ours. */
  out: "#D9FDD3",
  /** Theirs. */
  in: "#FFFFFF",
  ink: "#111B21",
  /** Timestamps, ticks, the second line of a list row. */
  muted: "#667781",
  /** Header and composer bars - a half-step off the canvas. */
  bar: "#F0F2F5",
  /** Read ticks, and nothing else. */
  read: "#53BDEB",
  /** Unread count. */
  badge: "#25D366",
  line: "#E9EDEF",
} as const;

/**
 * The faint pattern behind a conversation.
 *
 * <p>Our own drawing, not WhatsApp's file - that artwork is theirs. The same
 * idea, because the idea is what makes a chat read as a chat rather than as a
 * form: a scatter of one-stroke everyday objects on a tile big enough (260px)
 * that the repeat is not seen as a grid, at four and a half percent of the ink
 * colour - enough to stop the canvas reading as flat card stock, far too little
 * to compete with a word of text.
 *
 * <p>It replaced two sizes of ring, which tiled every 60px and read as
 * wallpaper. Inline as a data URI so the page still draws it with no connection.
 */
const CANVAS_PATTERN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260' viewBox='0 0 260 260'%3E%3Cg fill='none' stroke='%230B141A' stroke-opacity='0.045' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M30 42c-8-6-13-11-13-17a6 6 0 0 1 13-3 6 6 0 0 1 13 3c0 6-5 11-13 17z'/%3E%3Cpath d='M104 16l6 12 13 2-9 9 2 13-12-6-12 6 2-13-9-9 13-2z'/%3E%3Cpath d='M176 46a8 8 0 0 1 1-16 12 12 0 0 1 22-3 9 9 0 0 1 1 19z'/%3E%3Cpath d='M228 22h18v12a9 9 0 0 1-18 0z'/%3E%3Cpath d='M246 25h4a5 5 0 0 1 0 10h-4'/%3E%3Cpath d='M224 40h26'/%3E%3Ccircle cx='40' cy='104' r='14'/%3E%3Cpath d='M34 100v2M46 100v2M33 109a9 9 0 0 0 14 0'/%3E%3Cpath d='M92 112l38-15-15 38-6-14z'/%3E%3Cpath d='M92 112l25 9'/%3E%3Cpath d='M176 128V98l20-5v28'/%3E%3Ccircle cx='170' cy='128' r='6'/%3E%3Ccircle cx='190' cy='121' r='6'/%3E%3Cpath d='M240 88l-13 20h11l-5 18 15-21h-11z'/%3E%3Cpath d='M16 186c0-15 13-25 28-25 0 15-12 27-28 25z'/%3E%3Cpath d='M21 181l18-15'/%3E%3Cpath d='M96 156a16 16 0 1 0 10 25 18 18 0 0 1-10-25z'/%3E%3Cpath d='M140 158h8l3-5h12l3 5h8v20h-34z'/%3E%3Ccircle cx='157' cy='168' r='6'/%3E%3Cpath d='M230 150a11 11 0 1 1 22 0c0 8-11 16-11 16s-11-8-11-16z'/%3E%3Cpath d='M241 166v8'/%3E%3Cpath d='M22 232l16-13 16 13'/%3E%3Cpath d='M26 229v18h24v-18'/%3E%3Cpath d='M34 247v-9h8v9'/%3E%3Cpath d='M92 232c9-11 26-11 34 0-8 11-25 11-34 0z'/%3E%3Cpath d='M126 232l10-7v14z'/%3E%3Ccircle cx='102' cy='230' r='1.5'/%3E%3Ccircle cx='186' cy='224' r='4'/%3E%3Ccircle cx='186' cy='214' r='5'/%3E%3Ccircle cx='196' cy='224' r='5'/%3E%3Ccircle cx='186' cy='234' r='5'/%3E%3Ccircle cx='176' cy='224' r='5'/%3E%3Cpath d='M228 208h11v22h-11z'/%3E%3Cpath d='M239 208h11v22h-11z'/%3E%3Ccircle cx='128' cy='64' r='7'/%3E%3Cpath d='M128 52v-4M128 80v4M116 64h-4M144 64h4M120 56l-3-3M136 72l3 3M136 56l3-3M120 72l-3 3'/%3E%3Cpath d='M56 154h26v20H56z'/%3E%3Cpath d='M56 160h26M69 154v20'/%3E%3Cpath d='M69 154c-7-7-14-1-8 1 5 2 8-1 8-1zM69 154c7-7 14-1 8 1-5 2-8-1-8-1z'/%3E%3C/g%3E%3C/svg%3E\")";

/** Canvas plus pattern, for the two places that paint the conversation. */
const CANVAS = {
  backgroundColor: WA.canvas,
  backgroundImage: CANVAS_PATTERN,
} as const;

/**
 * How often each pane re-reads.
 *
 * <p>There is no push channel to the browser in this app, so a reply arrives
 * when the next poll asks for it. The open thread polls faster than the list
 * because that is the pane somebody is watching while they wait for an answer;
 * both stop entirely while the tab is hidden, so a forgotten tab costs nothing.
 */
const LIST_POLL_MS = 10_000;
const THREAD_POLL_MS = 6_000;

/** Poll only while the tab is actually being looked at. */
function usePoll(fn: () => void, ms: number, active = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (!document.hidden) saved.current();
    };
    const id = window.setInterval(tick, ms);
    // A tab that was hidden for an hour is a whole conversation behind; catch
    // up the moment it comes back rather than at the next interval.
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, active]);
}

/**
 * Unread messages across every thread, for the badge on the tab.
 *
 * <p>Its own tiny endpoint rather than a sum over the conversation list: the
 * badge is polled from a tab that has not loaded the list at all.
 */
export function useInboxUnread(enabled = true) {
  const [unread, setUnread] = useState(0);
  const load = useCallback(() => {
    if (!enabled) return;
    api
      .get<{ unread: number }>(`${BASE}/unread`)
      .then((r) => setUnread(r.unread))
      .catch(() => {
        /* The badge is decoration; a failure must not shout. */
      });
  }, [enabled]);
  useEffect(load, [load]);
  usePoll(load, LIST_POLL_MS, enabled);
  return { unread, refresh: load };
}

export function WhatsappInbox() {
  // `?c=<id>` is how the notification bell hands over a thread. Consumed once
  // and stripped, so a later back-navigation does not yank the reader out of
  // whatever conversation they have since moved to.
  const [params, setParams] = useSearchParams();
  const requested = params.get("c");

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(requested);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const query = useDebounced(search.trim(), 300);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (scope === "archived") params.set("archived", "true");
    if (scope === "replied") params.set("replied", "true");
    const suffix = params.toString();
    api
      .get<Conversation[]>(`${BASE}/conversations${suffix ? `?${suffix}` : ""}`)
      .then(setConversations)
      .catch(() => setConversations([]));
  }, [query, scope]);

  useEffect(load, [load]);
  usePoll(load, LIST_POLL_MS);

  useEffect(() => {
    if (!requested) return;
    setSelectedId(requested);
    setParams({}, { replace: true });
  }, [requested, setParams]);

  const selected = useMemo(
    () => conversations?.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  // A thread whose row vanished (search narrowed, or it was archived) must not
  // leave the reading pane showing a conversation that is no longer listed.
  useEffect(() => {
    if (requested) return;
    if (selectedId && conversations && !conversations.some((c) => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [conversations, selectedId, requested]);

  if (!conversations) return <LoaderBlock />;

  return (
    /* Height, not min-height: a chat has its OWN scroll - the list on one side
       and the thread on the other, each staying put while the other moves. A
       page-level scroll would drag the composer off the bottom of the screen
       the moment a thread got long. */
    /* Sized to what is actually left of the viewport. It was short by a hand's
       width, which put a strip of dead page under the composer - the one place
       on the screen where every pixel is the conversation. The mobile figure is
       larger because the layout's own top bar only exists below lg. */
    <div className="flex h-[calc(100dvh-16rem)] min-h-[26rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100dvh-13.5rem)]">
      <aside
        className={`flex w-full shrink-0 flex-col border-slate-200 sm:w-80 sm:border-e lg:w-96 ${
          selectedId ? "hidden sm:flex" : "flex"
        }`}
      >
        <ListHeader search={search} onSearch={setSearch} scope={scope} onScope={setScope} />
        <ConversationList
          rows={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          scope={scope}
        />
        <OpenByPhone
          search={query}
          found={conversations.length > 0}
          onOpened={(c) => {
            setSearch("");
            load();
            setSelectedId(c.id);
          }}
        />
      </aside>

      <section className={`min-w-0 flex-1 ${selectedId ? "flex" : "hidden sm:flex"}`}>
        {selected ? (
          <Thread
            key={selected.id}
            conversation={selected}
            onBack={() => setSelectedId(null)}
            onChanged={load}
          />
        ) : (
          <NothingSelected />
        )}
      </section>
    </div>
  );
}

const SCOPES: { key: Scope; label: string; title: string }[] = [
  { key: "all", label: "الكل", title: "كل المحادثات، بما فيها اللي النظام بدأها" },
  { key: "replied", label: "ردّوا", title: "اللي بعتوا لك رسالة — دول بس اللي ممكن ترد عليهم بنص حر" },
  { key: "archived", label: "المؤرشفة", title: "المحادثات اللي أخفيتها" },
];

function ListHeader({
  search,
  onSearch,
  scope,
  onScope,
}: {
  search: string;
  onSearch: (v: string) => void;
  scope: Scope;
  onScope: (v: Scope) => void;
}) {
  return (
    <div className="space-y-2 border-b border-slate-200 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-slate-400" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="ابحث باسم أو رقم"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pe-3 ps-9 text-sm outline-none transition focus:border-accent focus:bg-white"
        />
      </div>
      <div className="flex gap-1 text-xs font-semibold">
        {SCOPES.map((t) => (
          <button
            key={t.key}
            type="button"
            title={t.title}
            onClick={() => onScope(t.key)}
            className={`rounded-lg px-2.5 py-1 transition-all duration-200 active:scale-95 ${
              scope === t.key
                ? "bg-dark text-white shadow-sm"
                : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const EMPTY: Record<Scope, { title: string; hint?: string }> = {
  all: {
    title: "لا توجد محادثات بعد",
    hint: "المحادثة تُفتح بأول رسالة — سواء رسالة قالب يبعتها النظام، أو رسالة يبعتها ولي الأمر على رقم السنتر.",
  },
  replied: {
    title: "محدش رد لسه",
    hint: "هنا بس اللي بعتوا لك. دول اللي واتساب بيسمح لك ترد عليهم بنص حر، وليهم ٢٤ ساعة من آخر رسالة منهم.",
  },
  archived: { title: "لا توجد محادثات مؤرشفة" },
};

function ConversationList({
  rows,
  selectedId,
  onSelect,
  scope,
}: {
  rows: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  scope: Scope;
}) {
  if (rows.length === 0) {
    const empty = EMPTY[scope];
    return (
      <div className="flex flex-1 animate-fade-in flex-col items-center justify-center gap-2 p-6 text-center">
        <MessageCircle className="h-8 w-8 text-slate-300" />
        <p className="text-sm font-semibold text-slate-600">{empty.title}</p>
        {empty.hint && (
          <p className="max-w-[16rem] text-xs leading-5 text-slate-400">{empty.hint}</p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {rows.map((c, i) => (
        <ConversationRow
          key={c.id}
          row={c}
          index={i}
          active={c.id === selectedId}
          onClick={() => onSelect(c.id)}
        />
      ))}
    </div>
  );
}

function ConversationRow({
  row,
  index,
  active,
  onClick,
}: {
  row: Conversation;
  index: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className="animate-row relative flex w-full items-center gap-3 border-b px-3 py-2.5 text-start transition-colors duration-200 hover:bg-slate-50"
      style={{
        borderColor: WA.line,
        backgroundColor: active ? WA.bar : undefined,
        // Only the first screenful is staggered. Past that the delay would be
        // longer than the scroll takes to reach the row, so it would arrive
        // already late; and rows are keyed, so a poll that changes nothing
        // re-runs no animation at all.
        animationDelay: `${Math.min(index, 11) * 25}ms`,
      }}
    >
      {/* The selected row's own mark, growing from the middle out. The
          background tint alone was doing this job and it is nearly invisible
          against a list of white rows. */}
      <span
        aria-hidden
        className={`absolute inset-y-1 start-0 w-[3px] rounded-full transition-transform duration-200 ${
          active ? "scale-y-100" : "scale-y-0"
        }`}
        style={{ backgroundColor: WA.badge }}
      />
      <Avatar name={row.name} kind={row.contact_kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-slate-800">{row.name}</span>
          <span className="ms-auto shrink-0 text-[11px] text-slate-400">
            {whenShort(row.last_message_at)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-xs text-slate-500">
            {row.last_direction === "OUT" && <span className="text-slate-400">أنت: </span>}
            {row.last_preview ?? "—"}
          </p>
          {row.unread > 0 && (
            <span
              className="animate-scale-up shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: WA.badge }}
            >
              {arabicDigits(row.unread)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/** Egyptian mobile as the roster writes it: 01 and nine more digits. */
const PHONE = /^0?1\d{9}$/;

/**
 * The way in for a number nobody has a thread with yet.
 *
 * <p>It appears only when the search looks like a phone number and matched
 * nothing - the one moment it is the answer - so the list is not carrying a
 * permanent button for a rare job.
 *
 * <p>Opening a thread does NOT open the composer. That door is opened by the
 * other person writing, and by nothing else; what this gets you is the history
 * and somewhere for their reply to land.
 */
function OpenByPhone({
  search,
  found,
  onOpened,
}: {
  search: string;
  found: boolean;
  onOpened: (conversation: Conversation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const digits = search.replace(/\D/g, "").replace(/^20/, "");
  if (found || !PHONE.test(digits)) return null;

  const phone = digits.startsWith("0") ? digits : `0${digits}`;

  const open = () => {
    setBusy(true);
    api
      .post<Conversation>(`${BASE}/conversations`, { phone })
      .then(onOpened)
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "تعذّر فتح المحادثة"))
      .finally(() => setBusy(false));
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className="border-t border-slate-200 px-3 py-2.5 text-start text-xs font-semibold text-accent transition hover:bg-accent/5 disabled:opacity-50"
    >
      افتح محادثة مع <span dir="ltr">{phone}</span>
    </button>
  );
}

/**
 * Initials on a tinted disc.
 *
 * <p>Tinted by WHO they are rather than by a hash of the name: a parent and a
 * student are answered differently, and the list is scanned far more often than
 * it is read.
 */
function Avatar({ name, kind }: { name: string; kind: Conversation["contact_kind"] }) {
  const tone =
    kind === "PARENT"
      ? "bg-accent/15 text-accent"
      : kind === "STUDENT"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-slate-100 text-slate-400";
  const initial = name.trim().replace(/^[+\d]/, "").charAt(0);
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${tone}`}
    >
      {initial || <User className="h-4 w-4" />}
    </span>
  );
}

function NothingSelected() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
      style={CANVAS}
    >
      <MessageCircle className="h-10 w-10 text-slate-300" />
      <p className="text-sm font-semibold text-slate-600">اختر محادثة لقراءتها والرد عليها</p>
      <p className="max-w-sm text-xs leading-6 text-slate-400">
        الرد بنص حر مسموح لمدة ٢٤ ساعة من آخر رسالة يرسلها الشخص. بعدها لا يقبل واتساب إلا القوالب
        المعتمدة.
      </p>
    </div>
  );
}

// ── the thread ────────────────────────────────────────────────────────────

function Thread({
  conversation,
  onBack,
  onChanged,
}: {
  conversation: Conversation;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Whether the reader is at the bottom. A poll that lands while somebody is
  // reading back through last week must NOT yank them to the newest message.
  const pinned = useRef(true);

  const load = useCallback(() => {
    api
      .get<Message[]>(`${BASE}/conversations/${conversation.id}/messages`)
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [conversation.id]);

  useEffect(load, [load]);
  usePoll(load, THREAD_POLL_MS);

  // Opening a thread is reading it: clear the count here and put the blue ticks
  // on their side, then tell the list so the badge goes without a full reload.
  useEffect(() => {
    if (conversation.unread === 0) return;
    api
      .post(`${BASE}/conversations/${conversation.id}/read`)
      .then(onChanged)
      .catch(() => {
        /* Ticks are a courtesy; a failure changes nothing that matters. */
      });
  }, [conversation.id, conversation.unread, onChanged]);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const appended = (message: Message) => {
    pinned.current = true;
    setMessages((prev) => [...(prev ?? []), message]);
    onChanged();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <ThreadHeader conversation={conversation} onBack={onBack} onChanged={onChanged} />
      <WindowTimer conversation={conversation} />

      {/* The canvas holds the composer as well as the messages, so the pattern
          runs unbroken behind both and the box reads as floating ON the
          conversation rather than sitting on a grey shelf under it. Painting the
          composer's own strip instead would restart the tile and draw a seam
          across the screen at exactly the height the eye rests. */}
      <div className="flex min-h-0 flex-1 flex-col" style={CANVAS}>
        <div
          ref={scroller}
          onScroll={onScroll}
          className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4 sm:px-6"
        >
          {messages === null ? (
            <LoaderBlock />
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-400">لا توجد رسائل في هذه المحادثة</p>
          ) : (
            messages.map((m, i) => (
              <div key={m.id}>
                {dayChanged(messages[i - 1], m) && <DaySeparator iso={m.occurred_at} />}
                <Bubble message={m} />
              </div>
            ))
          )}
        </div>

        <Composer conversation={conversation} onSent={appended} />
      </div>
    </div>
  );
}

function ThreadHeader({
  conversation: c,
  onBack,
  onChanged,
}: {
  conversation: Conversation;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const archive = () => {
    setBusy(true);
    api
      .put(`${BASE}/conversations/${c.id}/archive?archived=${!c.archived}`)
      .then(() => {
        toast.success(c.archived ? "تمت إعادة المحادثة" : "تمت أرشفة المحادثة");
        onChanged();
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "تعذّر تنفيذ الطلب"))
      .finally(() => setBusy(false));
  };

  return (
    <header
      className="flex items-center gap-3 border-b px-3 py-2.5 sm:px-4"
      style={{ backgroundColor: WA.bar, borderColor: WA.line }}
    >
      <button
        type="button"
        onClick={onBack}
        aria-label="رجوع"
        className="-ms-1 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 sm:hidden"
      >
        <ArrowRight className="h-5 w-5" />
      </button>
      <Avatar name={c.name} kind={c.contact_kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-bold text-slate-800">{c.name}</h3>
          {c.contact_kind !== "UNKNOWN" && (
            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
              {c.contact_kind === "PARENT" ? "ولي أمر" : "طالب"}
            </span>
          )}
        </div>
        <p className="truncate text-[11px] text-slate-400">
          <span dir="ltr">{c.phone}</span>
          {c.student_code && <> · كود {arabicDigits(Number(c.student_code))}</>}
          {c.profile_name && c.student_name && <> · باسم «{c.profile_name}» على واتساب</>}
        </p>
      </div>
      <button
        type="button"
        onClick={archive}
        disabled={busy}
        className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
      >
        {c.archived ? "إعادة" : "أرشفة"}
      </button>
    </header>
  );
}

/**
 * The countdown on the window, ticking, at the top of the thread.
 *
 * <p>It sits here rather than under the composer because it is a fact about the
 * CONVERSATION, not about the text box - and because a deadline that matters is
 * read on the way in, not discovered after typing. Under the composer it was a
 * static line nobody looked at twice; here it moves, so it is believed.
 *
 * <p>It resets by itself. The thread's `window_ends_at` is re-read on every poll,
 * so the moment that person writes again the clock jumps back up to 24 hours
 * without anything here having to know that a message arrived.
 */
function WindowTimer({ conversation: c }: { conversation: Conversation }) {
  const [, tick] = useState(0);

  // One second, because it is a clock and a clock that jumps a minute at a time
  // reads as broken. One state bump per second on one mounted thread is free.
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!c.window_open || !c.window_ends_at) return null;

  const ms = new Date(c.window_ends_at).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;

  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  // Colour by how much is left, not by a fixed palette: under an hour the
  // window is the most urgent thing on the screen, and above six it is only
  // information.
  const tone =
    hours < 1
      ? "bg-rose-50 text-rose-700"
      : hours < 6
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-50 text-slate-500";

  return (
    <div
      className={`flex animate-fade-in items-center justify-center gap-2 border-b border-slate-200 px-3 py-1.5 text-[11px] font-semibold transition-colors duration-700 ${tone}`}
      title="واتساب يسمح بالرد بنص حر ٢٤ ساعة من آخر رسالة يرسلها الشخص. العدّاد يرجع من أوله لو بعت تاني."
    >
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span>متبقّي للرد الحر</span>
      {/* Latin tabular figures: Arabic-Indic digits are not tabular, so a
          ticking clock written in them jitters sideways every second. */}
      <span dir="ltr" className="font-clock tabular-nums tracking-tight">
        {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:
        {String(seconds).padStart(2, "0")}
      </span>
    </div>
  );
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span
        className="rounded-lg px-3 py-1 text-[11px] font-semibold shadow-sm"
        style={{ backgroundColor: WA.in, color: WA.muted }}
      >
        {dayLabel(iso)}
      </span>
    </div>
  );
}

/**
 * One message.
 *
 * <p>Outgoing sits at the inline END and incoming at the inline START, which on
 * this right-to-left page puts our replies on the left and theirs on the right -
 * the mirror of the familiar arrangement, and the one WhatsApp itself uses in
 * Arabic. Written as logical properties so it stays correct either way round.
 */
function Bubble({ message: m }: { message: Message }) {
  const out = m.direction === "OUT";
  const failed = m.status === "FAILED";

  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div
        // A tail on the outer corner, the WhatsApp way: the corner nearest the
        // speaker is squared off and the other three are round, which is what
        // makes a run of bubbles read as coming from one side before a single
        // word is read.
        className={`animate-bubble max-w-[85%] px-2.5 py-1.5 text-sm leading-6 shadow-sm sm:max-w-[70%] ${
          out ? "rounded-2xl rounded-es-md" : "rounded-2xl rounded-ss-md"
        }`}
        style={{
          backgroundColor: failed ? "#FFF1F2" : out ? WA.out : WA.in,
          color: failed ? "#881337" : WA.ink,
          border: failed ? "1px solid #FECDD3" : undefined,
        }}
      >
        {/* An automated message is not a typed one, and a teacher reading back
            through a thread has to be able to tell which sentences a person
            chose. The footer cannot say it - `sent_by_name` is null for these,
            precisely because nobody sent them. */}
        {m.kind === "template" && (
          <span
            title={
              m.template_name
                ? `رسالة تلقائية من النظام · قالب: ${m.template_name}`
                : "رسالة تلقائية أرسلها النظام كقالب معتمد"
            }
            className="mb-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: "rgba(0,0,0,0.06)", color: WA.muted }}
          >
            <FileText className="h-3 w-3" />
            تلقائية
          </span>
        )}
        {m.has_media && <Attachment message={m} outgoing={out} />}
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}

        <div
          className="mt-0.5 flex items-center justify-end gap-1 text-[10px]"
          style={{ color: failed ? "#9F1239" : WA.muted }}
        >
          {out && m.sent_by_name && <span className="truncate">{m.sent_by_name}</span>}
          <span>{clock(m.occurred_at)}</span>
          {out && <Ticks status={m.status} />}
        </div>

        {failed && (
          <p className="mt-1 border-t border-rose-200 pt-1 text-[11px] leading-5">
            <AlertCircle className="ms-0 me-1 inline h-3 w-3 align-[-2px]" />
            {m.failure_reason ?? "لم تصل الرسالة"}
            {m.failure_code ? ` (${m.failure_code})` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The delivery ticks.
 *
 * <p>One tick accepted, two delivered, two coloured read - the reading everybody
 * already knows from WhatsApp itself, so it needs no legend. The second tick is
 * a negative margin over the first rather than a separate glyph, because the
 * icon set has no double-check and inventing one would be a worse match than
 * overlapping the real one.
 */
function Ticks({ status }: { status: Message["status"] }) {
  if (status === "QUEUED") return <Clock className="h-3 w-3" />;
  if (status === "FAILED") return <AlertCircle className="h-3 w-3" />;

  const double = status === "DELIVERED" || status === "READ";
  return (
    <span className="inline-flex" style={status === "READ" ? { color: WA.read } : undefined}>
      <Check className="h-3 w-3" />
      {double && <Check className="-ms-1.5 h-3 w-3" />}
    </span>
  );
}

/**
 * A file somebody sent us.
 *
 * <p>Fetched through the app rather than linked: Meta's own media URLs expire
 * within minutes and need the platform access token, which must never reach a
 * browser. Images load themselves as soon as the bubble is on screen; anything
 * else waits for a click, because a thread should not pull down four videos to
 * paint itself.
 */
function Attachment({ message: m, outgoing }: { message: Message; outgoing: boolean }) {
  const isImage = (m.media_mime ?? "").startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const fetchIt = useCallback(async () => {
    setState("loading");
    try {
      const { blob } = await getFile(`${BASE}/messages/${m.id}/media`);
      setUrl(URL.createObjectURL(blob));
      setState("idle");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "تعذّر تحميل الملف");
      setState("error");
    }
  }, [m.id]);

  useEffect(() => {
    if (isImage) void fetchIt();
  }, [isImage, fetchIt]);

  // Blob URLs are held by the document until they are revoked; a long thread of
  // photos would leak every one of them on the way past.
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (isImage) {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="mb-1 block">
        <img
          src={url}
          alt={m.media_filename ?? "صورة"}
          className="max-h-72 w-full rounded-xl object-cover"
        />
      </a>
    ) : (
      <div className="mb-1 flex h-24 items-center justify-center rounded-xl bg-black/5 text-[11px] text-current/70">
        {state === "error" ? error : "جارٍ تحميل الصورة…"}
      </div>
    );
  }

  const name = m.media_filename ?? "ملف";
  return url ? (
    <a
      href={url}
      download={name}
      className={`mb-1 flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs font-semibold ${
        outgoing ? "bg-white/15" : "bg-slate-100"
      }`}
    >
      <Download className="h-4 w-4 shrink-0" />
      <span className="truncate">{name}</span>
    </a>
  ) : (
    <button
      type="button"
      onClick={() => void fetchIt()}
      disabled={state === "loading"}
      className={`mb-1 flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start text-xs font-semibold transition disabled:opacity-60 ${
        outgoing ? "bg-white/15 hover:bg-white/25" : "bg-slate-100 hover:bg-slate-200"
      }`}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="truncate">
        {state === "loading" ? "جارٍ التحميل…" : state === "error" ? error : name}
      </span>
    </button>
  );
}

// ── the composer ──────────────────────────────────────────────────────────

/**
 * Where the 24-hour rule becomes a control rather than a warning.
 *
 * <p>When the window is shut the box is not merely disabled - it is replaced,
 * by the sentence that explains why and what to do instead. A greyed-out text
 * box with a tooltip would leave the reader believing the feature was broken.
 */
/** Where the composer stops growing and starts scrolling. Matches `max-h-40`. */
const MAX_COMPOSER_PX = 160;

/** WhatsApp's own ceiling on one text message. The server refuses past it too. */
const MAX_BODY = 4096;

function Composer({
  conversation: c,
  onSent,
}: {
  conversation: Conversation;
  onSent: (message: Message) => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  // Where the caret was when focus left the box for the emoji palette.
  const caret = useRef<number | null>(null);

  const remember = () => {
    caret.current = box.current?.selectionStart ?? null;
  };

  /** Drop a glyph at the caret, not at the end - an emoji belongs mid-sentence. */
  const insertEmoji = (glyph: string) => {
    const el = box.current;
    const at = caret.current ?? el?.selectionStart ?? text.length;
    const next = text.slice(0, at) + glyph + text.slice(at);
    if (next.length > MAX_BODY) return;
    setText(next);
    const after = at + glyph.length;
    caret.current = after;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(after, after);
    });
  };

  /**
   * Grow with the text, and carry a scrollbar ONLY once there is something to
   * scroll.
   *
   * <p>A textarea reserves the gutter permanently the moment overflow is
   * scrollable, so a one-line box sat there with a dead grey stripe down its
   * side and the text pushed off-centre. Toggling overflow at the growth ceiling
   * is what makes it read as a line of text rather than as a form field.
   */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    const wanted = el.scrollHeight;
    el.style.height = `${Math.min(wanted, MAX_COMPOSER_PX)}px`;
    el.style.overflowY = wanted > MAX_COMPOSER_PX ? "auto" : "hidden";
  }, [text]);

  if (!c.window_open) {
    // Two different shuts, and telling them apart is the whole point. "It ran
    // out" is a thing that happened; "it was never open" is a thing that has
    // not happened yet, and reading the first when the second is true makes the
    // feature look broken - the teacher goes looking for the reply that expired
    // and there is none.
    const neverWrote = !c.last_inbound_at;
    return (
      <div className="animate-fade-in flex items-start gap-2 border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-800">
        <MessageCircleOff className="mt-0.5 h-4 w-4 shrink-0" />
        {neverWrote ? (
          <p>
            لسه محدش كتب من الرقم ده. واتساب مبيسمحش تبدأ بنص حر — الرسايل اللي بيبدأها السنتر
            لازم تكون <b>قوالب معتمدة</b>، وده اللي بتبعته أزرار الحضور والغياب والدرجات. أول ما
            يرد عليك، الشباك يفتح <b>٢٤ ساعة</b> وتقدر تكتب أي كلام.
          </p>
        ) : (
          <p>
            انتهت مدة الرد الحر. واتساب يسمح بالرد بنص حر لمدة <b>٢٤ ساعة</b> فقط من آخر رسالة
            يرسلها الشخص، وبعدها لا يقبل إلا القوالب المعتمدة. تقدر تبعتله رسالة قالب من أزرار
            الحضور أو الغياب أو الدرجات، ولو رد عليك تفتح المحادثة تاني.
          </p>
        )}
      </div>
    );
  }

  const send = () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    api
      .post<Message>(`${BASE}/conversations/${c.id}/messages`, { body })
      .then((m) => {
        setText("");
        onSent(m);
        if (m.status === "FAILED") {
          toast.error(m.failure_reason ?? "لم يقبل واتساب الرسالة");
        }
      })
      .catch((e) => toast.error(e instanceof ApiError ? e.message : "تعذّر إرسال الرسالة"))
      .finally(() => setSending(false));
  };

  return (
    /* One pill holding the text and the button, rather than a field with a
       button parked beside it. The whole strip is what takes the focus ring, so
       the two read as one control - which is what every messenger the reader
       has ever used looks like. */
    /* No bar, no border, no background of its own: the strip is transparent and
       the conversation shows through it, so the pill reads as floating on the
       chat rather than docked below it. The shadow is what lifts it off - it is
       doing the job the grey bar used to do, without cutting the canvas in
       two. */
    <div className="p-2 sm:p-3">
      <div className="flex items-end gap-1 rounded-[1.375rem] border border-transparent bg-white p-1 shadow-md transition focus-within:border-accent">
        <EmojiPickerButton
          onPick={insertEmoji}
          onBeforeOpen={remember}
          buttonClassName="mb-0.5 h-9 w-9 shrink-0"
        />
        <textarea
          ref={box}
          rows={1}
          value={text}
          maxLength={MAX_BODY}
          onChange={(e) => setText(e.target.value)}
          onSelect={remember}
          onKeyUp={remember}
          onClick={remember}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line. The composer is used far
            // more often for one sentence than for a paragraph.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="اكتب ردك…"
          aria-label="نص الرد"
          // The scrollbar is thin and only appears past the ceiling; the border,
          // the background and the ring all belong to the pill above, so the
          // textarea itself is transparent and chrome-free.
          className="max-h-40 flex-1 resize-none border-0 bg-transparent py-2 pe-1 text-sm leading-6 outline-none placeholder:text-slate-400 [scrollbar-width:thin]"
          style={{ color: WA.ink }}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || text.trim().length === 0}
          aria-label="إرسال (Enter)"
          title="Enter للإرسال · Shift+Enter لسطر جديد"
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-hover disabled:bg-slate-200 disabled:text-slate-400"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── formatting ────────────────────────────────────────────────────────────

/** ١:٤٥ م */
function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" });
}

/**
 * The timestamp on a list row: a clock today, a weekday this week, a date
 * before that - the shortest form that is still unambiguous, which is what a
 * scanned list needs.
 */
function whenShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = daysApart(d, new Date());
  if (days === 0) return clock(iso);
  if (days === 1) return "أمس";
  if (days < 7) return d.toLocaleDateString("ar-EG", { weekday: "long" });
  return d.toLocaleDateString("ar-EG", { day: "numeric", month: "numeric" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = daysApart(d, new Date());
  if (days === 0) return "اليوم";
  if (days === 1) return "أمس";
  return d.toLocaleDateString("ar-EG", { dateStyle: "long" });
}

/** Whole calendar days between two instants, ignoring the clock. */
function daysApart(a: Date, b: Date): number {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(b) - midnight(a)) / 86_400_000);
}

function dayChanged(previous: Message | undefined, current: Message): boolean {
  if (!previous) return true;
  return daysApart(new Date(previous.occurred_at), new Date(current.occurred_at)) !== 0;
}

