import { useEffect, useState } from "react";
import { Plus, Trash2, Save, Loader2, ShieldAlert, CheckCircle2, Mail, Contact } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { ConfirmDialog, inputClass } from "@/components/ui";
import { InfoHint } from "@/components/InfoHint";

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

export default function GoogleContactsPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const [disconnecting, setDisconnecting] = useState<{ id: string; email: string } | null>(null);
  const [connecting, setConnecting] = useState(false);

  function loadStatus() {
    api.get<Status>("/google/status").then(setStatus).catch(() => setStatus(null));
  }
  function loadMarks() {
    api.get<Mark[]>("/google/marks").then(setMarks).catch(() => setMarks([]));
  }
  useEffect(() => {
    loadStatus();
    loadMarks();
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

      {/* Connected accounts */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10">
              <Contact className="h-5 w-5 text-accent" />
            </span>
            <h2 className="text-lg font-bold text-slate-800">الحسابات المرتبطة</h2>
          </div>
          <button
            onClick={connect}
            disabled={!status.enabled || !status.configured || connecting}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
          >
            {connecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            ربط حساب Google
          </button>
        </div>

        {status.accounts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center">
            <Mail className="mx-auto mb-2 h-9 w-9 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">لا توجد حسابات مرتبطة بعد</p>
            <p className="mt-1 text-xs text-slate-400">اربط حساب Google لتبدأ مزامنة الأرقام تلقائيًا.</p>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {status.accounts.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 transition hover:bg-slate-50"
              >
                <span className="flex items-center gap-2 text-sm text-slate-700" dir="ltr">
                  <Mail className="h-4 w-4 text-slate-400" />
                  {a.email}
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                </span>
                <button
                  onClick={() => setDisconnecting(a)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" />
                  فصل
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Per-grade marks */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-slate-800">علامات الصفوف</h2>
          <InfoHint text="علامة تُضاف بعد اسم الطالب لتمييز صاحب الرقم: علامة للطالب، وأخرى لولي الأمر، وثالثة عندما يكون الرقم لكليهما (نفس الرقم). العلامات اختيارية؛ إن تُركت فارغة يُحفَظ الاسم فقط." />
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[640px] text-right text-sm">
            <thead className={THEAD}>
              <tr>
                <th className="px-4 py-3 font-medium">الصف</th>
                <th className="px-4 py-3 font-medium">علامة الطالب</th>
                <th className="px-4 py-3 font-medium">علامة ولي الأمر</th>
                <th className="px-4 py-3 font-medium">علامة الرقم المشترك</th>
                <th className="px-4 py-3 font-medium"></th>
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
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">لا توجد صفوف بعد.</td>
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

function MarkRow({ mark, onSaved }: { mark: Mark; onSaved: (m: Mark) => void }) {
  const [student, setStudent] = useState(mark.student_mark ?? "");
  const [parent, setParent] = useState(mark.parent_mark ?? "");
  const [both, setBoth] = useState(mark.both_mark ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    student !== (mark.student_mark ?? "") ||
    parent !== (mark.parent_mark ?? "") ||
    both !== (mark.both_mark ?? "");

  async function save() {
    setSaving(true);
    try {
      const updated = await api.put<Mark>(`/google/marks/${mark.grade_id}`, {
        student_mark: student,
        parent_mark: parent,
        both_mark: both,
      });
      onSaved(updated);
      toast.success(`تم حفظ علامات "${mark.grade_name}"`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر حفظ العلامات");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className={mark.grade_active ? "" : "bg-slate-50/60"}>
      <td className="px-4 py-3 font-medium text-slate-800">{mark.grade_name}</td>
      <td className="px-4 py-2">
        <input value={student} onChange={(e) => setStudent(e.target.value)} className={inputClass} placeholder="مثال: ١ث" />
      </td>
      <td className="px-4 py-2">
        <input value={parent} onChange={(e) => setParent(e.target.value)} className={inputClass} placeholder="مثال: ١ث ولي" />
      </td>
      <td className="px-4 py-2">
        <input value={both} onChange={(e) => setBoth(e.target.value)} className={inputClass} placeholder="مثال: ١ث مشترك" />
      </td>
      <td className="px-4 py-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          حفظ
        </button>
      </td>
    </tr>
  );
}
