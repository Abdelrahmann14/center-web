import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  ShieldAlert,
  CheckCircle2,
  Check,
  Mail,
  RotateCcw,
} from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { GOOGLE_CONNECTED } from "@/lib/appEvents";
import { toast } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { ConfirmDialog } from "@/components/ui";
import { EmojiInput } from "@/components/EmojiInput";
import { InfoHint } from "@/components/InfoHint";
import { GoogleLogo } from "@/components/GoogleLogo";

interface Status {
  enabled: boolean;
  configured: boolean;
  accounts: { id: string; email: string }[];
}

interface Mark {
  grade_id: string;
  grade_name: string;
  grade_active: boolean;
  student_mark: string | null;
  parent_mark: string | null;
  both_mark: string | null;
}

/** One slice of a full check, as the server reports it. */
interface ResyncBatch {
  total: number;
  processed: number;
  /** Numbers already correct in Google - nothing was written for them. */
  ok: number;
  updated: number;
  created: number;
  /** > 0 = Google's minute is full; this slice did not run, wait and repeat it. */
  retry_after: number;
  done: boolean;
}

/** How many students one request carries. The server caps it at 25. */
const BATCH = 25;

const sleep = (seconds: number) => new Promise((r) => setTimeout(r, seconds * 1000));

export default function GoogleContactsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const [disconnecting, setDisconnecting] = useState<{ id: string; email: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [resync, setResync] = useState<{ done: number; total: number; waiting?: number } | null>(
    null,
  );

  function loadStatus() {
    api.get<Status>("/google/status").then(setStatus).catch(() => setStatus(null));
  }
  function loadMarks() {
    api.get<Mark[]>("/google/marks").then(setMarks).catch(() => setMarks([]));
  }
  useEffect(() => {
    loadStatus();
    loadMarks();
    // The OAuth return opens this page while the code is still being exchanged,
    // so the first read can land before the account exists. This is the exchange
    // saying it is done.
    const onConnected = () => loadStatus();
    window.addEventListener(GOOGLE_CONNECTED, onConnected);
    return () => window.removeEventListener(GOOGLE_CONNECTED, onConnected);
  }, []);

  async function connect() {
    setConnecting(true);
    try {
      const { url } = await api.get<{ url: string }>("/google/oauth-url");
      window.location.href = url; // Google consent, returns to app root with ?code
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر بدء ربط Google");
      setConnecting(false);
    }
  }

  // Coming BACK from Google - consent given or cancelled - leaves the button
  // still spinning: the page was never unloaded, it was restored, so nothing
  // ever cleared the flag. Any return to this page clears it.
  useEffect(() => {
    const clear = () => setConnecting(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") clear();
    };
    window.addEventListener("pageshow", clear);
    window.addEventListener("focus", clear);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pageshow", clear);
      window.removeEventListener("focus", clear);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /**
   * Walk the whole roster, a slice at a time: each number in the system is
   * looked up in the connected accounts, left alone when it is already there
   * under the right name, renamed when the name differs, and created when it is
   * missing - until every number is accounted for.
   *
   * <p>The loop is here rather than on the server so the bar below moves with
   * real progress and no single request runs long enough to be cut off. When
   * Google says its per-minute quota is spent, the run PAUSES and repeats the
   * same slice rather than failing: the work is not lost, it is just early.
   */
  async function syncAll() {
    if (resync) return;
    setResync({ done: 0, total: 0 });
    let offset = 0;
    let ok = 0;
    let updated = 0;
    let created = 0;
    try {
      for (;;) {
        const batch = await api.post<ResyncBatch>(
          `/google/resync/batch?offset=${offset}&limit=${BATCH}`,
        );
        if (batch.retry_after > 0) {
          setResync({ done: batch.processed, total: batch.total, waiting: batch.retry_after });
          await sleep(batch.retry_after);
          setResync({ done: batch.processed, total: batch.total });
          continue; // same offset: this slice never ran
        }
        ok += batch.ok;
        updated += batch.updated;
        created += batch.created;
        offset = batch.processed;
        setResync({ done: batch.processed, total: batch.total });
        if (batch.done || batch.total === 0) break;
      }
      const ar = (n: number) => n.toLocaleString("ar-EG");
      const changed = updated + created;
      toast.success(
        changed === 0
          ? `كل الأرقام مسجّلة على الحساب بالفعل (${ar(ok)} رقم)`
          : `تم تسجيل كل الأرقام على الحساب - أُضيف ${ar(created)}، وصُحّح ${ar(updated)}، و${ar(ok)} كان سليماً`,
      );
      loadStatus();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّرت مزامنة جهات الاتصال");
    } finally {
      setResync(null);
    }
  }

  async function disconnect(id: string) {
    try {
      const s = await api.del<Status>(`/google/accounts/${id}`);
      setStatus(s);
      toast.success("تم فصل الحساب");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر فصل الحساب");
    } finally {
      setDisconnecting(null);
    }
  }

  if (!status || !marks) return <LoaderBlock />;

  const canConnect = status.enabled && status.configured;

  return (
    <div className="space-y-6">
      {!status.configured && (
        <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          لم يتم إعداد تكامل Google على الخادم بعد. تواصل مع الإدارة.
        </div>
      )}
      {status.configured && !status.enabled && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          لم تُفعّل الإدارة مزامنة جهات اتصال Google لحسابك بعد. يمكنك تجهيز العلامات، وسيبدأ الحفظ فور التفعيل.
        </div>
      )}

      {/* Connection + connected accounts */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
              <GoogleLogo className="h-6 w-6" />
            </span>
            <h2 className="text-lg font-bold text-slate-800">جهات اتصال Google</h2>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              onClick={connect}
              disabled={!canConnect || connecting}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
            >
              {connecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
              ربط حساب Google
            </button>
            {/* Writes every student's numbers to every connected account: a
                number that was never saved is created, one saved under the
                wrong name is renamed, so Google ends up holding exactly what
                the system holds. */}
            <button
              onClick={syncAll}
              disabled={!canConnect || status.accounts.length === 0 || resync !== null}
              title={
                status.accounts.length === 0
                  ? "اربط حساب Google أولاً"
                  : "حفظ أرقام كل الطلاب في الحسابات المرتبطة"
              }
              className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-700 transition hover:border-accent/50 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resync ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <RotateCcw className="h-5 w-5" />
              )}
              مزامنة كل الأرقام
            </button>
          </div>
        </div>

        {resync && (
          <ResyncProgress done={resync.done} total={resync.total} waiting={resync.waiting} />
        )}

        <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            الحسابات المرتبطة
          </p>
          {status.accounts.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Mail className="h-4 w-4" />
              لا يوجد حساب مرتبط بعد.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {status.accounts.map((a) => (
                <span
                  key={a.id}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white py-1.5 pe-1.5 ps-3 text-sm shadow-sm"
                >
                  <GoogleLogo className="h-4 w-4" />
                  <span dir="ltr" className="font-medium text-slate-700">
                    {a.email}
                  </span>
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <button
                    onClick={() => setDisconnecting(a)}
                    title="فصل الحساب"
                    className="ms-0.5 rounded-lg p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Per-grade marks */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800">علامات الصفوف</h2>
          <InfoHint text="علامة تُضاف بعد اسم الطالب - أي على يساره - لتمييز صاحب الرقم: علامة للطالب، وأخرى لولي الأمر، وثالثة عندما يكون الرقم لكليهما (نفس الرقم). تقبل أي حروف أو أرقام أو رموز تعبيرية، وتظهر على يسار الاسم دائمًا مهما كان اتجاه الكتابة في الهاتف. العلامات اختيارية؛ إن تُركت فارغة يُحفَظ الاسم فقط." />
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] text-right text-sm">
            <thead className={THEAD}>
              <tr>
                <th className="px-4 py-3 font-medium">الصف</th>
                <th className="px-4 py-3 font-medium">علامة الطالب</th>
                <th className="px-4 py-3 font-medium">علامة ولي الأمر</th>
                <th className="px-4 py-3 font-medium">علامة الرقم المشترك</th>
                <th className="w-28 px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {marks.map((m, i) => (
                <MarkRow
                  key={m.grade_id}
                  mark={m}
                  onSaved={(updated) => setMarks((list) => list!.map((x, j) => (j === i ? updated : x)))}
                />
              ))}
              {marks.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    لا توجد صفوف بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {disconnecting && (
        <ConfirmDialog
          title="فصل حساب Google"
          message={`سيتوقف حفظ جهات الاتصال في (${disconnecting.email}). لن تُحذف جهات الاتصال الموجودة.`}
          confirmLabel="فصل"
          danger
          onConfirm={() => disconnect(disconnecting.id)}
          onClose={() => setDisconnecting(null)}
        />
      )}
    </div>
  );
}

/**
 * How far the run has come. The count is real - each slice reports the roster
 * size and what it has covered - so the bar never guesses; before the first
 * slice answers, the total is unknown and the bar sits at zero rather than
 * inventing a width.
 */
function ResyncProgress({
  done,
  total,
  waiting,
}: {
  done: number;
  total: number;
  /** Seconds being waited out because Google's per-minute quota is full. */
  waiting?: number;
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="border-t border-slate-100 px-5 py-4">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-500">
        <span>
          {waiting
            ? `حد Google للدقيقة اكتمل - يُستأنف بعد ${waiting.toLocaleString("ar-EG")} ثانية`
            : total > 0
              ? `${done.toLocaleString("ar-EG")} من ${total.toLocaleString("ar-EG")} طالب`
              : "جارٍ قراءة قائمة الطلاب…"}
        </span>
        <span className="tabular-nums text-accent">{percent.toLocaleString("ar-EG")}٪</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved";

function MarkRow({ mark, onSaved }: { mark: Mark; onSaved: (m: Mark) => void }) {
  const [student, setStudent] = useState(mark.student_mark ?? "");
  const [parent, setParent] = useState(mark.parent_mark ?? "");
  const [both, setBoth] = useState(mark.both_mark ?? "");
  const [state, setState] = useState<SaveState>("idle");

  // The last values persisted to the server. An autosave fires only when the
  // current values drift from this snapshot, so mount and echoed props never
  // trigger a needless write.
  const savedRef = useRef({
    s: mark.student_mark ?? "",
    p: mark.parent_mark ?? "",
    b: mark.both_mark ?? "",
  });

  // Debounced autosave: 800ms after the last keystroke settles.
  useEffect(() => {
    const saved = savedRef.current;
    if (student === saved.s && parent === saved.p && both === saved.b) return;

    const timer = setTimeout(async () => {
      setState("saving");
      try {
        const updated = await api.put<Mark>(`/google/marks/${mark.grade_id}`, {
          student_mark: student,
          parent_mark: parent,
          both_mark: both,
        });
        savedRef.current = {
          s: updated.student_mark ?? "",
          p: updated.parent_mark ?? "",
          b: updated.both_mark ?? "",
        };
        onSaved(updated);
        setState("saved");
        toast.success(`تم حفظ علامات "${mark.grade_name}"`);
      } catch (err) {
        setState("idle");
        toast.error(err instanceof ApiError ? err.message : "تعذّر حفظ العلامات");
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student, parent, both]);

  // The "saved" tick is a confirmation, not a permanent state - let it fade.
  useEffect(() => {
    if (state !== "saved") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <tr className={mark.grade_active ? "" : "bg-slate-50/60"}>
      <td className="px-4 py-3 font-medium text-slate-800">{mark.grade_name}</td>
      {/* Any text works here - Arabic, Latin, digits. The palette only reaches
          the glyphs a keyboard cannot: emoji and typographic marks. */}
      <td className="px-4 py-2">
        <EmojiInput
          value={student}
          onChange={setStudent}
          maxLength={40}
          ariaLabel={`علامة الطالب - ${mark.grade_name}`}
          placeholder="مثال: ١ث 🎓"
        />
      </td>
      <td className="px-4 py-2">
        <EmojiInput
          value={parent}
          onChange={setParent}
          maxLength={40}
          ariaLabel={`علامة ولي الأمر - ${mark.grade_name}`}
          placeholder="مثال: ١ث ولي 👪"
        />
      </td>
      <td className="px-4 py-2">
        <EmojiInput
          value={both}
          onChange={setBoth}
          maxLength={40}
          ariaLabel={`علامة الرقم المشترك - ${mark.grade_name}`}
          placeholder="مثال: ١ث مشترك ⭐"
        />
      </td>
      <td className="px-4 py-2">
        <SaveStatus state={state} />
      </td>
    </tr>
  );
}

/** Live autosave feedback, replacing the old per-row Save button. */
function SaveStatus({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        جارٍ الحفظ…
      </span>
    );
  if (state === "saved")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
        <Check className="h-3.5 w-3.5" />
        تم الحفظ
      </span>
    );
  return null;
}
