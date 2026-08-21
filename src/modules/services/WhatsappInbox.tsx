import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  occurred_at: string;
  delivered_at: string | null;
  read_at: string | null;
};

const BASE = "/messaging/whatsapp/inbox";

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
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const query = useDebounced(search.trim(), 300);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (archived) params.set("archived", "true");
    const suffix = params.toString();
    api
      .get<Conversation[]>(`${BASE}/conversations${suffix ? `?${suffix}` : ""}`)
      .then(setConversations)
      .catch(() => setConversations([]));
  }, [query, archived]);

  useEffect(load, [load]);
  usePoll(load, LIST_POLL_MS);

  const selected = useMemo(
    () => conversations?.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  // A thread whose row vanished (search narrowed, or it was archived) must not
  // leave the reading pane showing a conversation that is no longer listed.
  useEffect(() => {
    if (selectedId && conversations && !conversations.some((c) => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [conversations, selectedId]);

  if (!conversations) return <LoaderBlock />;

  return (
    /* Height, not min-height: a chat has its OWN scroll - the list on one side
       and the thread on the other, each staying put while the other moves. A
       page-level scroll would drag the composer off the bottom of the screen
       the moment a thread got long. */
    <div className="flex h-[calc(100vh-16rem)] min-h-[30rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <aside
        className={`flex w-full shrink-0 flex-col border-slate-200 sm:w-80 sm:border-e lg:w-96 ${
          selectedId ? "hidden sm:flex" : "flex"
        }`}
      >
        <ListHeader
          search={search}
          onSearch={setSearch}
          archived={archived}
          onArchived={setArchived}
        />
        <ConversationList
          rows={conversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          archived={archived}
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

function ListHeader({
  search,
  onSearch,
  archived,
  onArchived,
}: {
  search: string;
  onSearch: (v: string) => void;
  archived: boolean;
  onArchived: (v: boolean) => void;
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
        <button
          type="button"
          onClick={() => onArchived(false)}
          className={`rounded-lg px-2.5 py-1 transition ${
            archived ? "text-slate-500 hover:bg-slate-100" : "bg-dark text-white"
          }`}
        >
          الحالية
        </button>
        <button
          type="button"
          onClick={() => onArchived(true)}
          className={`rounded-lg px-2.5 py-1 transition ${
            archived ? "bg-dark text-white" : "text-slate-500 hover:bg-slate-100"
          }`}
        >
          المؤرشفة
        </button>
      </div>
    </div>
  );
}

function ConversationList({
  rows,
  selectedId,
  onSelect,
  archived,
}: {
  rows: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  archived: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <MessageCircle className="h-8 w-8 text-slate-300" />
        <p className="text-sm font-semibold text-slate-600">
          {archived ? "لا توجد محادثات مؤرشفة" : "لا توجد محادثات بعد"}
        </p>
        {!archived && (
          <p className="max-w-[16rem] text-xs leading-5 text-slate-400">
            المحادثة تبدأ عندما يرسل ولي الأمر أو الطالب رسالة على رقم السنتر. الرسائل التي ترسلها
            أنت بالأزرار لا تفتح محادثة.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {rows.map((c) => (
        <ConversationRow
          key={c.id}
          row={c}
          active={c.id === selectedId}
          onClick={() => onSelect(c.id)}
        />
      ))}
    </div>
  );
}

function ConversationRow({
  row,
  active,
  onClick,
}: {
  row: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-start transition ${
        active ? "bg-accent/10" : "hover:bg-slate-50"
      }`}
    >
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
            <span className="shrink-0 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">
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
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
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

      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-6"
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
    <header className="flex items-center gap-3 border-b border-slate-200 px-3 py-2.5 sm:px-4">
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

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex justify-center">
      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-slate-400 shadow-sm">
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
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-6 shadow-sm sm:max-w-[70%] ${
          failed
            ? "border border-rose-200 bg-rose-50 text-rose-900"
            : out
              ? "bg-accent text-white"
              : "border border-slate-200 bg-white text-slate-800"
        }`}
      >
        {m.has_media && <Attachment message={m} outgoing={out} />}
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}

        <div
          className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${
            failed ? "text-rose-400" : out ? "text-white/70" : "text-slate-400"
          }`}
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
    <span className={`inline-flex ${status === "READ" ? "text-sky-300" : ""}`}>
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

  // Grow with the text, up to a point - past that the thread would disappear.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  if (!c.window_open) {
    return (
      <div className="flex items-start gap-2 border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-800">
        <MessageCircleOff className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          انتهت مدة الرد الحر. واتساب يسمح بالرد بنص حر لمدة <b>٢٤ ساعة</b> فقط من آخر رسالة يرسلها
          الشخص، وبعدها لا يقبل إلا القوالب المعتمدة. تقدر تبعتله رسالة قالب من أزرار الحضور أو
          الغياب أو الدرجات، ولو رد عليك تفتح المحادثة تاني.
        </p>
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
    <div className="border-t border-slate-200 bg-white px-3 py-2.5 sm:px-4">
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          rows={1}
          value={text}
          maxLength={4096}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line. The composer is used far
            // more often for one sentence than for a paragraph.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="اكتب ردك…"
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 outline-none transition focus:border-accent focus:bg-white"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || text.trim().length === 0}
          aria-label="إرسال"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-[10px] text-slate-400">
        {remainingAr(c.window_ends_at)} · Enter للإرسال، Shift+Enter لسطر جديد
      </p>
    </div>
  );
}

// ── formatting ────────────────────────────────────────────────────────────

const AR = (n: number) => n.toLocaleString("ar-EG");

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

/**
 * How long is left to answer freely.
 *
 * <p>Deliberately a duration and not a deadline: "٣ ساعات" is something a
 * person acts on, while "تنتهي ٤:١٥ م" has to be worked out against the clock
 * first, and the whole point of the line is to say "answer now".
 */
function remainingAr(endsAt: string | null): string {
  if (!endsAt) return "الرد الحر متاح";
  const ms = new Date(endsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "انتهت مدة الرد";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `متبقّي ${AR(minutes)} دقيقة للرد الحر`;
  return `متبقّي ${AR(Math.floor(minutes / 60))} ساعة للرد الحر`;
}
