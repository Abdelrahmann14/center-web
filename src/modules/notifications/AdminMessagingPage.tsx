import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Loader2, Search, X, MessageCircle, History, Check, Users, Clock, CheckCircle2, Ban, RotateCcw,
  ChevronDown, UserPlus, ClipboardCheck, FileChartColumn,
} from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { cachedGetAll } from "@/lib/dataCache";
import { usePageState } from "@/lib/pageState";
import { useDebounced } from "@/lib/useDebounced";
import { useOnline } from "@/lib/useOnline";
import { useAuth } from "@/auth/AuthContext";
import { toast } from "@/components/ui/toast";
import { Toggle } from "@/components/Toggle";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { Select, Field, Modal, FormNotice, inputClass } from "@/components/ui";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";
import { DatePicker } from "@/components/DatePicker";
import { Pagination } from "@/components/Pagination";
import { RELIGIONS, GENDERS, ALL_TRACKS } from "@/lib/tracks";
import { groupLabel, type Grade, type Group } from "@/modules/students/StudentForm";
import { fmtDateTime } from "@/lib/datetime";
import { VariableTextArea } from "./VariableTextArea";

// ── Shared types ───────────────────────────────────────────────────────────

type Audience = "STUDENT" | "PARENT" | "BOTH";
type AutomationKind = "ATTENDANCE" | "ABSENCE" | "NEW_STUDENT" | "EXAM_GRADE" | "REPORT";

interface Automation {
  type: AutomationKind;
  enabled: boolean;
  audience: Audience;
  week_start_day: number | null;
  week_end_day: number | null;
  base: string;
  base_send_as_image: boolean;
  alternatives: { id: string; body: string; send_as_image: boolean }[];
}

interface LogRow {
  id: string;
  recipient_name: string | null;
  phone: string | null;
  recipient_code: string | null;
  recipient_type: string;
  body: string;
  status: string;
  failure_reason: string | null;
  source: string;
  origin: string;
  sent_by_name: string | null;
  created_at: string;
}

interface Hit { id: string; name: string; detail: string }

const EMPTY_SET: ReadonlySet<string> = new Set();
const AUDIENCE: { v: Audience; l: string }[] = [
  { v: "STUDENT", l: "الطالب" },
  { v: "PARENT", l: "ولي الأمر" },
  { v: "BOTH", l: "كلاهما" },
];

// ── Page shell ───────────────────────────────────────────────────────────────

type Tab = "history" | "automated";

export default function AdminMessagingPage() {
  const { effectiveRole } = useAuth();
  const isAdmin = effectiveRole === "admin";
  const online = useOnline();
  const [tab, setTab] = useState<Tab>("history");
  const [sending, setSending] = useState(false);

  return (
    <div>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-dark">الرسائل</h1>
          <p className="mt-1 text-sm text-slate-500">رسائل واتساب: إرسال يدوي، رسائل تلقائية، وسجل كل ما أُرسِل.</p>
        </div>
        <button
          onClick={() => setSending(true)}
          disabled={!online}
          title={online ? undefined : "لا يوجد اتصال بالإنترنت"}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
        >
          <Send className="h-5 w-5" />
          إرسال
        </button>
      </header>

      <div className="mt-5 flex w-fit flex-wrap gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
        <TabButton active={tab === "history"} onClick={() => setTab("history")} icon={<History className="h-4 w-4" />}>
          السجل
        </TabButton>
        {isAdmin && (
          <TabButton active={tab === "automated"} onClick={() => setTab("automated")} icon={<MessageCircle className="h-4 w-4" />}>
            الرسائل التلقائية
          </TabButton>
        )}
      </div>

      <div key={tab} className="mt-6 animate-fade-in">
        {tab === "history" ? <HistoryTab /> : <AutomatedTab />}
      </div>

      {sending && <SendModal onClose={() => setSending(false)} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
        active ? "bg-dark text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
        active ? "border-accent bg-accent text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {active && <Check className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

function AudiencePicker({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {AUDIENCE.map((a) => (
        <Chip key={a.v} active={value === a.v} onClick={() => onChange(a.v)}>{a.l}</Chip>
      ))}
    </div>
  );
}

// ── Manual send (WhatsApp only) ──────────────────────────────────────────────

function SendModal({ onClose }: { onClose: () => void }) {
  const [religions, setReligions] = useState<Set<string>>(new Set());
  const [genders, setGenders] = useState<Set<string>>(new Set());
  const [grades, setGrades] = useState<Grade[]>([]);
  const [pickedGrades, setPickedGrades] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<Group[]>([]);
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(new Set());
  const [track, setTrack] = useState("");
  const [students, setStudents] = useState<Hit[]>([]);
  const [parents, setParents] = useState<Hit[]>([]);
  const [audience, setAudience] = useState<Audience>("STUDENT");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const online = useOnline();

  useEffect(() => {
    api.get<Grade[]>("/grades").then(setGrades).catch(() => {});
    api.get<Group[]>("/groups").then(setGroups).catch(() => {});
  }, []);

  const toggleIn = (set: Set<string>, key: string) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  };

  const hasRecipient =
    religions.size > 0 || genders.size > 0 || pickedGrades.size > 0 || pickedGroups.size > 0 ||
    !!track || students.length > 0 || parents.length > 0;

  async function send() {
    setError("");
    if (!hasRecipient) return setError("اختر معيار مستلمين واحدًا على الأقل");
    if (!body.trim()) return setError("نص الرسالة مطلوب");
    setBusy(true);
    try {
      const res = await api.post<{ sent: number; failed: number; total: number }>("/messaging/whatsapp/send", {
        student_ids: students.map((s) => s.id),
        parent_ids: parents.map((p) => p.id),
        grades: [...pickedGrades],
        group_ids: [...pickedGroups],
        genders: [...genders],
        religions: [...religions],
        academic_track: track || null,
        audience,
        body: body.trim(),
      });
      const failed = res.failed > 0 ? `، فشل ${res.failed.toLocaleString("ar-EG")}` : "";
      toast.success(`تم إرسال ${res.sent.toLocaleString("ar-EG")} رسالة${failed}`, { title: "تم الإرسال" });
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "تعذّر إرسال الرسائل";
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="إرسال رسالة واتساب"
      subtitle="تُرسَل عبر واتساب فقط - لا علاقة لها بإشعارات التطبيق."
      size="2xl"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">
            إلغاء
          </button>
          <button type="button" onClick={send} disabled={busy || !online} title={online ? undefined : "لا يوجد اتصال بالإنترنت"} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            إرسال
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="space-y-4">
          <p className="text-sm font-semibold text-slate-700">المستلمون</p>
          <div className="flex flex-wrap gap-2">
            {RELIGIONS.map((r) => (
              <Chip key={r} active={religions.has(r)} onClick={() => setReligions((s) => toggleIn(s, r))}>{r === "مسلم" ? "المسلمون" : "المسيحيون"}</Chip>
            ))}
            {GENDERS.map((g) => (
              <Chip key={g} active={genders.has(g)} onClick={() => setGenders((s) => toggleIn(s, g))}>{g === "ذكر" ? "الذكور" : "الإناث"}</Chip>
            ))}
          </div>

          {grades.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">الصفوف</p>
              <div className="flex flex-wrap gap-2">
                {grades.map((g) => (
                  <Chip key={g.id} active={pickedGrades.has(g.name)} onClick={() => setPickedGrades((s) => toggleIn(s, g.name))}>{g.name}</Chip>
                ))}
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">المجموعات</p>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => (
                  <Chip key={g.id} active={pickedGroups.has(g.id)} onClick={() => setPickedGroups((s) => toggleIn(s, g.id))}>{groupLabel(g)}</Chip>
                ))}
              </div>
            </div>
          )}

          <Field label="الشعبة (اختياري)">
            <Select value={track} onChange={setTrack} placeholder="كل الشعب" options={[{ value: "", label: "كل الشعب" }, ...ALL_TRACKS.map((t) => ({ value: t, label: t }))]} />
          </Field>

          <HitPicker label="طلاب محددون" endpoint="/messaging/students/search" picked={students} onChange={setStudents} />
          <HitPicker label="أولياء أمور محددون" endpoint="/messaging/parents/search" picked={parents} onChange={setParents} />
        </div>

        <div className="space-y-4 border-t border-slate-100 pt-5">
          <Field plain label="إرسال إلى">
            <AudiencePicker value={audience} onChange={setAudience} />
            <p className="mt-1.5 text-xs text-slate-400">يُطبَّق على الطلاب المحددين بالمعايير. أولياء الأمور المحددون بالاسم يستلمون دائمًا.</p>
          </Field>
          <Field plain label="نص الرسالة">
            <VariableTextArea value={body} onChange={setBody} rows={7} />
          </Field>
        </div>

        <FormNotice message={error} />
      </div>
    </Modal>
  );
}

function HitPicker({ label, endpoint, picked, onChange }: { label: string; endpoint: string; picked: Hit[]; onChange: (h: Hit[]) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (!q.trim()) { setHits([]); return; }
    const t = setTimeout(() => {
      api.get<Hit[]>(`${endpoint}?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, endpoint]);

  function add(h: Hit) {
    if (!picked.some((x) => x.id === h.id)) onChange([...picked, h]);
    setQ("");
    setHits([]);
  }

  return (
    <Field plain label={label}>
      {picked.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {picked.map((h) => (
            <span key={h.id} className="flex items-center gap-1.5 rounded-full bg-accent/10 py-1 pe-1 ps-3 text-sm text-accent">
              {h.name}
              <button onClick={() => onChange(picked.filter((x) => x.id !== h.id))} className="rounded-full p-0.5 hover:bg-accent/20">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم" className={`${inputClass} pr-9`} />
        {hits.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-lg">
            {hits.map((h) => (
              <button key={h.id} onClick={() => add(h)} className="flex w-full items-center gap-3 px-3 py-2 text-right transition hover:bg-slate-50">
                <span className="flex-1 text-sm text-slate-800">{h.name}</span>
                <span className="text-xs text-slate-400">{h.detail}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}

// ── Automated messages ───────────────────────────────────────────────────────

function AutomatedTab() {
  const [items, setItems] = useState<Automation[] | null>(null);

  useEffect(() => {
    api.get<Automation[]>("/messaging/whatsapp/automations").then(setItems).catch(() => setItems([]));
  }, []);

  if (!items) return <LoaderBlock />;

  return (
    <div className="space-y-4">
      {items.map((a, i) => (
        <div key={a.type} style={{ animationDelay: `${i * 90}ms` }} className="motion-safe:animate-fade-in">
          <AutomationCard automation={a} />
        </div>
      ))}
    </div>
  );
}

/**
 * Saves a setting the moment it is switched, and never on the first render.
 *
 * <p>Only for discrete controls - a toggle, a checkbox. Flipping one IS the
 * decision, so there is nothing to wait for. Free text is different and is
 * handled by {@link useFlushOnUnmount} plus the field's own blur: it used to run
 * on a timer after every keystroke, which meant a success toast every second or
 * so while someone was still composing a sentence.
 */
function useSettingSave(save: () => void, deps: unknown[]): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * The safety net under save-on-blur: leaving the page (or closing the screen)
 * without touching anything else must not drop the last edit. `save` is expected
 * to be a no-op when nothing actually changed, so this costs nothing in the
 * normal case - including StrictMode's throwaway first unmount.
 */
function useFlushOnUnmount(save: () => void): void {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => () => latest.current(), []);
}

/** Staggered reveal: each body section fades and rises in when the card opens. */
function Reveal({ open, delay, children }: { open: boolean; delay: number; children: React.ReactNode }) {
  return (
    <div
      style={{ transitionDelay: `${open ? delay : 0}ms` }}
      className={`transition-all duration-300 ease-out motion-reduce:!transition-none motion-reduce:!translate-y-0 motion-reduce:!opacity-100 ${
        open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

type CardTheme = { iconBg: string; iconText: string; hover: string; lift: string };

// Each automation type carries its own title, blurb, icon and colour so the four
// cards read apart at a glance. The raised 3D lip takes the type's own accent.
const AUTOMATION_META: Record<
  AutomationKind,
  {
    title: string;
    description: string;
    Icon: React.ComponentType<{ className?: string }>;
    t: CardTheme;
    /** When true the card has no recipient control - the sender chooses per send. */
    hideAudience?: boolean;
  }
> = {
  ATTENDANCE: {
    title: "رسالة الحضور",
    description: "تُرسَل فور تسجيل الحضور عند تفعيل التبديل في صفحة تسجيل الحضور، أو يدويًا من صفحة الحصص.",
    Icon: CheckCircle2,
    t: {
      iconBg: "bg-accent/10", iconText: "text-accent",
      hover: "hover:border-accent/30",
      lift: "shadow-[0_5px_0_0_var(--color-accent-hover),0_12px_20px_-5px_rgb(15_23_42_/_0.22)] hover:shadow-[0_8px_0_0_var(--color-accent-hover),0_22px_30px_-6px_rgb(15_23_42_/_0.30)]",
    },
  },
  ABSENCE: {
    title: "رسالة الغياب",
    description: "تُرسَل من زر «إرسال رسائل الغياب» داخل المجموعة في صفحة الحصص.",
    Icon: Ban,
    t: {
      iconBg: "bg-amber-100", iconText: "text-amber-600",
      hover: "hover:border-amber-200",
      lift: "shadow-[0_5px_0_0_#d97706,0_12px_20px_-5px_rgb(15_23_42_/_0.22)] hover:shadow-[0_8px_0_0_#d97706,0_22px_30px_-6px_rgb(15_23_42_/_0.30)]",
    },
  },
  NEW_STUDENT: {
    title: "رسالة طالب جديد",
    description: "تُرسَل تلقائيًا فور إضافة طالب جديد، ومعها بطاقة الباركود (PDF). ونفسها تُرسَل من زر الباركود للطالب.",
    Icon: UserPlus,
    t: {
      iconBg: "bg-emerald-100", iconText: "text-emerald-600",
      hover: "hover:border-emerald-200",
      lift: "shadow-[0_5px_0_0_#059669,0_12px_20px_-5px_rgb(15_23_42_/_0.22)] hover:shadow-[0_8px_0_0_#059669,0_22px_30px_-6px_rgb(15_23_42_/_0.30)]",
    },
  },
  EXAM_GRADE: {
    title: "رسالة درجة الاختبار",
    description: "تُرسَل من زر «إرسال درجات الاختبار» داخل المجموعة في صفحة الحصص.",
    Icon: ClipboardCheck,
    t: {
      iconBg: "bg-violet-100", iconText: "text-violet-600",
      hover: "hover:border-violet-200",
      lift: "shadow-[0_5px_0_0_#7c3aed,0_12px_20px_-5px_rgb(15_23_42_/_0.22)] hover:shadow-[0_8px_0_0_#7c3aed,0_22px_30px_-6px_rgb(15_23_42_/_0.30)]",
    },
  },
  REPORT: {
    title: "رسالة التقرير",
    description: "النص الذي يُرسَل مع تقرير الطالب (PDF) عند الضغط على «إرسال التقرير». المستلم يُختار وقت الإرسال.",
    Icon: FileChartColumn,
    hideAudience: true,
    t: {
      iconBg: "bg-sky-100", iconText: "text-sky-600",
      hover: "hover:border-sky-200",
      lift: "shadow-[0_5px_0_0_#0284c7,0_12px_20px_-5px_rgb(15_23_42_/_0.22)] hover:shadow-[0_8px_0_0_#0284c7,0_22px_30px_-6px_rgb(15_23_42_/_0.30)]",
    },
  },
};

/** One recipient checkbox (parent / student), styled as a pill. */
function RecipientCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
        checked ? "border-accent bg-accent/10 text-accent" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
      }`}
    >
      <span className={`grid h-3.5 w-3.5 place-items-center rounded border ${checked ? "border-accent bg-accent text-white" : "border-slate-300 bg-white"}`}>
        {checked && <Check className="h-2.5 w-2.5" />}
      </span>
      {label}
    </button>
  );
}

/** The one setting a single message carries, sized to sit in its chrome line. */
function ImageSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-500">
      <Toggle checked={checked} onChange={onChange} />
      إرسال كصورة
    </label>
  );
}

function AutomationCard({ automation }: { automation: Automation }) {
  const { title, description, Icon, t, hideAudience } = AUTOMATION_META[automation.type];
  const [open, setOpen] = useState(false);
  const [base, setBase] = useState(automation.base);
  const [baseSendAsImage, setBaseSendAsImage] = useState(automation.base_send_as_image);
  // Recipient is two checkboxes; both on = BOTH. At least one stays on.
  const [toParent, setToParent] = useState(automation.audience !== "STUDENT");
  const [toStudent, setToStudent] = useState(automation.audience !== "PARENT");
  const [generating, setGenerating] = useState(false);
  const [alternatives, setAlternatives] = useState(automation.alternatives);

  const audience: Audience = toParent && toStudent ? "BOTH" : toStudent ? "STUDENT" : "PARENT";

  /**
   * What the server already holds. Everything below compares against it, so a
   * save happens when something genuinely changed and at no other time - that is
   * what stops a toast appearing for a click that changed nothing.
   */
  const saved = useRef({
    base: automation.base.trim(),
    image: automation.base_send_as_image,
    audience: (automation.audience ?? "BOTH") as Audience,
  });

  const persist = useCallback(async () => {
    const next = { base: base.trim(), image: baseSendAsImage, audience };
    const prev = saved.current;
    if (next.base === prev.base && next.image === prev.image && next.audience === prev.audience) {
      return;
    }
    // Claimed before the request so two flushes in a row (a blur that lands with
    // an unmount) cannot send the same change twice.
    saved.current = next;
    try {
      await api.put(`/messaging/whatsapp/automations/${automation.type.toLowerCase()}`, {
        base: next.base,
        base_send_as_image: next.image,
        audience: next.audience,
      });
      toast.success("تم تحديث الرسالة");
    } catch (err) {
      // Still unsaved, so the next blur or switch tries again.
      saved.current = prev;
      toast.error(err instanceof ApiError ? err.message : "تعذّر الحفظ");
    }
  }, [automation.type, base, baseSendAsImage, audience]);

  // The two settings save as they are switched; the message text saves when the
  // author leaves the box (onCommit below), and again on the way out.
  useSettingSave(() => void persist(), [baseSendAsImage, audience]);
  useFlushOnUnmount(() => void persist());

  async function generate() {
    if (!base.trim()) { toast.error("اكتب الرسالة الأساسية أولاً"); return; }
    setGenerating(true);
    try {
      // Persist the base first so the server rewords the current text.
      await persist();
      const res = await api.post<Automation>(`/messaging/whatsapp/automations/${automation.type.toLowerCase()}/generate`);
      setAlternatives(res.alternatives);
      toast.success("تم توليد صيغ بديلة");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر توليد الصيغ");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all duration-300 ${t.hover} ${t.lift} motion-safe:hover:-translate-y-1`}
    >
      {/* Collapsed summary row - the whole header toggles the card. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 pl-3 pr-4 text-right"
      >
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${t.iconBg} ${t.iconText} transition-transform duration-300 motion-safe:group-hover:scale-110`}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-slate-800">{title}</h2>
          {/* Only the name and what the message is for - never the message text itself. */}
          <p className="mt-0.5 truncate text-xs text-slate-500">{description}</p>
        </div>
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition-all duration-300 group-hover:bg-slate-100 ${open ? "rotate-180" : ""}`}>
          <ChevronDown className="h-5 w-5" />
        </span>
      </button>

      {/* Body animates open by growing the grid row from 0fr to 1fr. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
            {/* One settings line: who gets it, and the button that writes variants. */}
            <Reveal open={open} delay={40}>
              <div className="flex flex-wrap items-center gap-2">
                {!hideAudience && (
                  <>
                    <span className="text-xs font-medium text-slate-500">يستلمها</span>
                    <RecipientCheck
                      label="ولي الأمر"
                      checked={toParent}
                      onChange={(v) => (v || toStudent) && setToParent(v)}
                    />
                    <RecipientCheck
                      label="الطالب"
                      checked={toStudent}
                      onChange={(v) => (v || toParent) && setToStudent(v)}
                    />
                  </>
                )}
                <button
                  onClick={generate}
                  disabled={generating}
                  className="ms-auto flex items-center gap-1.5 rounded-lg border border-accent/40 px-2.5 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/10 active:scale-95 disabled:opacity-60"
                >
                  {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  توليد صيغ بديلة
                </button>
              </div>
            </Reveal>

            <Reveal open={open} delay={90}>
              <VariableTextArea
                value={base}
                onChange={setBase}
                rows={2}
                leading={<ImageSwitch checked={baseSendAsImage} onChange={setBaseSendAsImage} />}
                onCommit={() => void persist()}
              />
            </Reveal>

            {alternatives.length > 0 && (
              <Reveal open={open} delay={140}>
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-500">صيغ بديلة</p>
                  {alternatives.map((alt, i) => (
                    <AlternativeEditor key={alt.id} index={i + 1} alternative={alt} tint={t.iconBg} />
                  ))}
                </div>
              </Reveal>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function AlternativeEditor({
  index,
  alternative,
  tint,
}: {
  index: number;
  alternative: { id: string; body: string; send_as_image: boolean };
  /** The card type's own colour, so a variant is read as part of its message. */
  tint: string;
}) {
  const [body, setBody] = useState(alternative.body);
  const [sendAsImage, setSendAsImage] = useState(alternative.send_as_image);

  // Same rule as the base message: the switch saves at once, the text saves when
  // the author steps out of it. The in-place mutation keeps the parent in sync.
  const persist = useCallback(async () => {
    const next = { body: body.trim(), image: sendAsImage };
    if (next.body === alternative.body && next.image === alternative.send_as_image) return;
    const prev = { body: alternative.body, image: alternative.send_as_image };
    alternative.body = next.body;
    alternative.send_as_image = next.image;
    try {
      await api.put(`/messaging/whatsapp/automations/variants/${alternative.id}`, {
        body: next.body,
        send_as_image: next.image,
      });
      toast.success(`تم تحديث الصيغة ${index}`);
    } catch (err) {
      alternative.body = prev.body;
      alternative.send_as_image = prev.image;
      toast.error(err instanceof ApiError ? err.message : "تعذّر الحفظ");
    }
  }, [alternative, index, body, sendAsImage]);

  useSettingSave(() => void persist(), [sendAsImage]);
  useFlushOnUnmount(() => void persist());

  return (
    <div>
      {/* The colour rides the writing surface, not the space around it. */}
      <VariableTextArea
        value={body}
        onChange={setBody}
        rows={1}
        leading={<ImageSwitch checked={sendAsImage} onChange={setSendAsImage} />}
        fieldTint={tint}
        onCommit={() => void persist()}
      />
    </div>
  );
}

// ── History (send log) ───────────────────────────────────────────────────────

const STATUS_AR: Record<string, string> = { SENT: "تم الإرسال", FAILED: "فشل" };
const SOURCE_AR: Record<string, string> = { SYSTEM: "تلقائي", MANUAL: "يدوي" };
const ORIGIN_AR: Record<string, string> = {
  ATTENDANCE: "حضور",
  ABSENCE: "غياب",
  NEW_STUDENT: "طالب جديد",
  EXAM_GRADE: "درجة اختبار",
  MANUAL: "يدوي",
  BARCODE: "باركود",
  REPORT: "تقرير",
  INVOICE: "فاتورة",
  broadcast: "إعلان عام",
  exam_result: "نتيجة اختبار",
  student_verification: "كود تحقق",
  student_password_reset: "استعادة كلمة السر",
  parent_password_reset: "استعادة كلمة السر (ولي أمر)",
  parent_link_approved_wa: "قبول ربط ولي أمر",
  parent_link_rejected_wa: "رفض ربط ولي أمر",
};
// Who a message went to. TEACHER is the workspace owner's own number (the
// invoice PDFs go there); OTHER is a number that belongs to nobody on the
// roster, which is now the only case the table has nothing to name.
const TYPE_AR: Record<string, string> = {
  STUDENT: "طالب",
  PARENT: "ولي أمر",
  TEACHER: "المدرّس",
  OTHER: "رقم خارجي",
};

const FIELDS = [
  { key: "status", label: "الحالة", ar: STATUS_AR },
  { key: "source", label: "المصدر", ar: SOURCE_AR },
  { key: "origin", label: "النوع", ar: ORIGIN_AR },
  { key: "recipient_type", label: "المستلم", ar: TYPE_AR },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
const ROWS_OPTIONS = ["10", "25", "50"];

/** Folds Arabic letter variants so "احمد" matches "أحمد", "مصطفى" matches "مصطفي". */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْـ]/g, "");
}

/** The message's type as a coloured chip, grouped by what kind of send it was. */
const ORIGIN_TONE: Record<string, string> = {
  ATTENDANCE: "bg-teal-50 text-teal-700",
  ABSENCE: "bg-amber-50 text-amber-700",
  NEW_STUDENT: "bg-emerald-50 text-emerald-700",
  EXAM_GRADE: "bg-violet-50 text-violet-700",
  BARCODE: "bg-blue-50 text-blue-700",
  REPORT: "bg-blue-50 text-blue-700",
  INVOICE: "bg-blue-50 text-blue-700",
  broadcast: "bg-violet-50 text-violet-700",
  exam_result: "bg-green-50 text-green-700",
};

function OriginChip({ origin }: { origin: string }) {
  const cls = ORIGIN_TONE[origin] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      {ORIGIN_AR[origin] ?? origin}
    </span>
  );
}

function HistoryTab() {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [search, setSearch] = usePageState("messages.search", "");
  const [date, setDate] = usePageState("messages.date", "");
  const [page, setPage] = usePageState("messages.page", 1);
  const [perPageStr, setPerPageStr] = usePageState("messages.rows", "25");
  const [colF, setColF] = useState<Partial<Record<FieldKey, Set<string>>>>({});
  const perPage = Number(perPageStr) || 25;
  const debounced = useDebounced(search);
  const mounted = useRef(false);

  useEffect(() => {
    cachedGetAll<LogRow>("/messaging/whatsapp/log").then(setRows).catch(() => setRows([]));
  }, []);

  const setCol = (key: FieldKey, next: Set<string>) => setColF((c) => ({ ...c, [key]: next }));

  const distinct = useMemo(() => {
    const out: Record<FieldKey, string[]> = { status: [], source: [], origin: [], recipient_type: [] };
    if (!rows) return out;
    for (const f of FIELDS) {
      const seen = new Set<string>();
      for (const r of rows) {
        const raw = r[f.key] as string;
        if (raw) seen.add(f.ar[raw] ?? raw);
      }
      out[f.key] = [...seen];
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = debounced.trim().toLowerCase();
    return rows.filter((r) => {
      if (date && r.created_at.slice(0, 10) !== date) return false;
      for (const f of FIELDS) {
        const set = colF[f.key];
        if (set && set.size > 0) {
          const display = f.ar[r[f.key] as string] ?? (r[f.key] as string);
          if (!set.has(display)) return false;
        }
      }
      if (q) {
        const hay = norm(`${r.recipient_name ?? ""} ${r.phone ?? ""} ${r.recipient_code ?? ""} ${r.body}`);
        if (!hay.includes(norm(q))) return false;
      }
      return true;
    });
  }, [rows, debounced, date, colF]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice((current - 1) * perPage, current * perPage);

  useEffect(() => {
    if (mounted.current) setPage(1);
    else mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, date, colF, perPageStr]);

  const activeTags = FIELDS.flatMap((f) =>
    [...(colF[f.key] ?? [])].map((value) => ({ key: f.key, label: f.label, value })));

  function removeTag(key: FieldKey, value: string) {
    setColF((c) => {
      const next = new Set(c[key] ?? []);
      next.delete(value);
      return { ...c, [key]: next };
    });
  }

  if (!rows) return <LoaderBlock />;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الرقم أو الكود أو النص"
            className={`${inputClass} pr-9`}
          />
        </div>
        {FIELDS.map((f) => (
          <MultiSelectFilter
            key={f.key}
            label={f.label}
            options={distinct[f.key]}
            selected={colF[f.key] ?? EMPTY_SET}
            onChange={(s) => setCol(f.key, s)}
          />
        ))}
        <DatePicker value={date} onChange={setDate} placeholder="كل الأيام" clearLabel="كل الأيام" />
        {date && (
          <button onClick={() => setDate("")} className="flex items-center gap-1.5 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50">
            <RotateCcw className="h-4 w-4" />
            كل الأيام
          </button>
        )}
        <div className="ms-auto flex items-center gap-2 text-sm text-slate-500">
          <span>عرض</span>
          <div className="w-20">
            <Select value={perPageStr} onChange={setPerPageStr} options={ROWS_OPTIONS.map((r) => ({ value: r, label: r }))} />
          </div>
        </div>
      </div>

      {activeTags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {activeTags.map((t) => (
            <span key={`${t.key}:${t.value}`} className="animate-scale-up flex items-center gap-1 rounded-full bg-accent/10 py-1 pe-1 ps-2.5 text-xs font-medium text-accent">
              <span className="text-accent/70">{t.label}:</span>
              {t.value}
              <button onClick={() => removeTag(t.key, t.value)} aria-label={`إزالة ${t.value}`} className="rounded-full p-0.5 transition hover:bg-accent/20">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[960px] text-right text-sm">
          <thead className={`${THEAD} font-medium`}>
            <tr>
              <th className="px-4 py-3">المستلم</th>
              <th className="px-4 py-3">النوع</th>
              <th className="px-4 py-3">الرقم</th>
              <th className="px-4 py-3">الكود</th>
              <th className="px-4 py-3">الرسالة</th>
              <th className="px-4 py-3">الحالة</th>
              <th className="px-4 py-3">المصدر</th>
              <th className="px-4 py-3">التاريخ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => {
              const failed = r.status === "FAILED";
              return (
                <tr key={r.id} className={failed ? "bg-rose-100 hover:bg-rose-200" : "hover:bg-slate-50/60"}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{r.recipient_name || "-"}</div>
                    <div className="text-[11px] text-slate-400">{TYPE_AR[r.recipient_type] ?? r.recipient_type}</div>
                  </td>
                  <td className="px-4 py-3"><OriginChip origin={r.origin} /></td>
                  <td className="px-4 py-3 text-slate-600" dir="ltr">{r.phone || "-"}</td>
                  <td className="px-4 py-3 text-slate-500">{r.recipient_code || "-"}</td>
                  <td className="max-w-xs px-4 py-3">
                    <p className="line-clamp-2 text-slate-700" title={r.body}>{r.body}</p>
                    {failed && r.failure_reason && (
                      <p className="mt-0.5 text-[11px] text-rose-700">{r.failure_reason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {failed ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700"><Ban className="h-3.5 w-3.5" /> فشل</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> تم الإرسال</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <div>{SOURCE_AR[r.source] ?? r.source}</div>
                    {r.source === "MANUAL" && r.sent_by_name && <div className="text-slate-400">{r.sent_by_name}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500" dir="ltr">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{fmtDateTime(r.created_at)}</span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  <MessageCircle className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                  لا توجد رسائل مطابقة
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination current={current} totalPages={totalPages} onChange={setPage} />

      <div className="mt-4">
        <span className="text-xs text-slate-400">
          <Users className="ml-1 inline h-3.5 w-3.5" />
          {filtered.length.toLocaleString("ar-EG")} رسالة
        </span>
      </div>
    </div>
  );
}
