// Exams grouped by stage (dynamically from the configured grades). Each card
// shows the exam and, once scheduled, its date and assigned groups without
// opening it. Admin-only (route + nav gate this).
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, CalendarClock, CheckCircle2, Clock, Copy, FileText, KeyRound, ListChecks, Loader2, Pencil, Plus, Send, Users } from "lucide-react";
import { DeleteButton } from "@/components/DeleteButton";
import { api, ApiError } from "@/lib/api";
import { cachedGet, invalidate, useCachedGet } from "@/lib/dataCache";
import { useToast } from "@/components/Toast";
import { LoaderBlock } from "@/components/PencilLoader";
import { ConfirmDialog, FormNotice, Modal, MultiSelect } from "@/components/ui";
import { fmtTime } from "@/lib/datetime";
import ExamForm from "./ExamForm";
import { todayIso, type Exam, type GroupPassword, type LectureLite } from "./types";

interface Grade {
  id: string;
  name: string;
  is_active: boolean;
}
interface Group {
  id: string;
  day_of_week: number;
  start_time: string;
  center_name: string;
  grade: string;
  is_active: boolean;
}

const DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
function groupLabel(g: Group): string {
  return `${DAYS[g.day_of_week] ?? ""} · ${fmtTime((g.start_time ?? "").slice(0, 5))} · ${g.center_name}`;
}

export default function ExamsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data: exams, loading, reload } = useCachedGet<Exam[]>("/exams");
  const [grades, setGrades] = useState<Grade[]>([]);
  const [lectures, setLectures] = useState<LectureLite[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Exam | null>(null);
  const [scheduling, setScheduling] = useState<Exam | null>(null);
  const [publishing, setPublishing] = useState<Exam | null>(null);
  const [deleting, setDeleting] = useState<Exam | null>(null);

  useEffect(() => {
    cachedGet<Grade[]>("/grades").then(setGrades).catch(() => {});
    cachedGet<Group[]>("/groups").then(setGroups).catch(() => {});
    cachedGet<{ content: LectureLite[] }>("/lectures?size=2000&sort=createdAt,desc")
      .then((p) => setLectures(p.content))
      .catch(() => {});
  }, []);

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  // Sections in the order grades were configured, then any leftover stage.
  const sections = useMemo(() => {
    const byGrade = new Map<string, Exam[]>();
    for (const e of exams ?? []) {
      const key = e.grade ?? "غير مصنّف";
      (byGrade.get(key) ?? byGrade.set(key, []).get(key)!).push(e);
    }
    const ordered: { stage: string; exams: Exam[] }[] = [];
    for (const g of grades) {
      const list = byGrade.get(g.name);
      if (list) {
        ordered.push({ stage: g.name, exams: list });
        byGrade.delete(g.name);
      }
    }
    for (const [stage, list] of byGrade) ordered.push({ stage, exams: list });
    return ordered;
  }, [exams, grades]);

  function onCreated(exam: Exam, isEdit: boolean) {
    invalidate("/exams");
    if (isEdit) {
      setEditing(null);
      reload();
    } else {
      // Straight into the builder, as specified.
      setCreating(false);
      navigate(`/exams/${exam.id}/build`);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await api.del(`/exams/${deleting.id}`);
      invalidate("/exams");
      toast("تم حذف الاختبار");
      reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "تعذّر حذف الاختبار", "error");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-end">
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white hover:bg-accent-hover"
        >
          <Plus className="h-5 w-5" />
          اختبار جديد
        </button>
      </div>

      {loading && !exams ? (
        <LoaderBlock />
      ) : sections.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center text-slate-400">
          لا توجد اختبارات بعد. ابدأ بإنشاء اختبار جديد.
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map(({ stage, exams: list }) => (
            <section key={stage}>
              <h2 className="mb-3 text-lg font-bold text-slate-700">{stage}</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((exam) => (
                  <ExamCard
                    key={exam.id}
                    exam={exam}
                    groupsById={groupsById}
                    onBuild={() => navigate(`/exams/${exam.id}/build`)}
                    onSchedule={() => setScheduling(exam)}
                    onPublish={() => setPublishing(exam)}
                    onEdit={() => setEditing(exam)}
                    onDelete={() => setDeleting(exam)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {creating && (
        <ExamForm lectures={lectures} onSaved={onCreated} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <ExamForm
          initial={editing}
          lectures={lectures}
          onSaved={onCreated}
          onClose={() => setEditing(null)}
        />
      )}
      {scheduling && (
        <ScheduleDialog
          exam={scheduling}
          groups={groups}
          onClose={() => setScheduling(null)}
          onDone={() => {
            invalidate("/exams");
            setScheduling(null);
            reload();
          }}
        />
      )}
      {publishing && (
        <PublishDialog
          exam={publishing}
          groups={groups}
          onClose={() => setPublishing(null)}
          onDone={() => {
            invalidate("/exams");
            setPublishing(null);
            reload();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="حذف الاختبار"
          message={`سيتم حذف "${deleting.name}" وكل أسئلته. لا يمكن التراجع.`}
          confirmLabel="حذف"
          danger
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function ExamCard({
  exam,
  groupsById,
  onBuild,
  onSchedule,
  onPublish,
  onEdit,
  onDelete,
}: {
  exam: Exam;
  groupsById: Map<string, Group>;
  onBuild: () => void;
  onSchedule: () => void;
  onPublish: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const scheduledGroups = exam.group_ids
    .map((id) => groupsById.get(id))
    .filter((g): g is Group => !!g);
  // Publish is only offered once the exam is scheduled (a date + at least one group).
  const scheduled = !!exam.scheduled_date && exam.group_ids.length > 0;

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-bold text-slate-800">{exam.name}</h3>
            {exam.published && (
              <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                منشور
              </span>
            )}
          </div>
          {exam.lecture_name && <p className="truncate text-sm text-slate-500">{exam.lecture_name}</p>}
        </div>
        <div className="flex shrink-0 gap-1">
          <button onClick={onEdit} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-accent" title="تعديل">
            <Pencil className="h-4 w-4" />
          </button>
          <DeleteButton onClick={onDelete} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Stat icon={<ListChecks className="h-3.5 w-3.5" />} label="الأسئلة" value={String(exam.question_count)} />
        <Stat icon={<Award className="h-3.5 w-3.5" />} label="الدرجة النهائية" value={exam.max_score != null ? String(exam.max_score) : "..."} />
        <Stat icon={<Clock className="h-3.5 w-3.5" />} label="المدة" value={`${exam.duration_minutes} دقيقة`} />
        <Stat
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          label="تاريخ الاختبار"
          value={exam.scheduled_date ?? "غير مجدول"}
          muted={!exam.scheduled_date}
        />
        <div className="col-span-2">
          <Stat
            icon={<Users className="h-3.5 w-3.5" />}
            label="المجموعات المسندة"
            value={scheduledGroups.length ? scheduledGroups.map(groupLabel).join("، ") : "لم تُسند بعد"}
            muted={scheduledGroups.length === 0}
          />
        </div>
      </div>

      {scheduled && exam.group_passwords.length > 0 && (
        <div className="mt-3">
          <GroupPasswords passwords={exam.group_passwords} groupsById={groupsById} />
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="flex gap-2">
          <button
            onClick={onBuild}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-4 w-4" />
            الأسئلة
          </button>
          <button
            onClick={onSchedule}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent/10 py-2 text-sm font-medium text-accent hover:bg-accent/20"
          >
            <CalendarClock className="h-4 w-4" />
            جدولة
          </button>
        </div>

        {scheduled && (
          <div className="mt-2">
            <button
              onClick={onPublish}
              disabled={!exam.complete}
              title={exam.complete ? undefined : "النشر غير متاح حتى تكتمل جميع عمليات التحقق"}
              className={`flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium transition ${
                exam.complete
                  ? "bg-green-600 text-white hover:bg-green-700"
                  : "cursor-not-allowed bg-slate-100 text-slate-400"
              }`}
            >
              <Send className="h-4 w-4" />
              نشر
            </button>
            {!exam.complete && (
              <p className="mt-1 text-center text-xs text-amber-600">
                النشر غير متاح حتى يكتمل الاختبار (توزيع الدرجات مطابق للدرجة النهائية).
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// One labelled value, boxed for readability and hierarchy on the exam card.
function Stat({
  icon,
  label,
  value,
  muted = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-1 text-xs text-slate-500">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1 truncate font-semibold ${muted ? "text-slate-400" : "text-slate-800"}`}
        title={value}
        dir="auto"
      >
        {value}
      </div>
    </div>
  );
}

// One password per assigned group, each with its own label and copy button. A
// fresh set is generated on every publish, so groups never share a secret.
function GroupPasswords({
  passwords,
  groupsById,
}: {
  passwords: GroupPassword[];
  groupsById: Map<string, Group>;
}) {
  return (
    <div className="space-y-2">
      {passwords.map((gp) => {
        const g = groupsById.get(gp.group_id);
        return (
          <PasswordField
            key={gp.group_id}
            password={gp.password}
            label={g ? `كلمة مرور ${groupLabel(g)}` : "كلمة مرور المجموعة"}
          />
        );
      })}
    </div>
  );
}

// Read-only password with a one-click copy, shown to the admin (given to students
// in person). Copies via the clipboard API with a toast confirmation.
function PasswordField({ password, label = "كلمة مرور الاختبار" }: { password: string; label?: string }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      toast("تم نسخ كلمة المرور");
    } catch {
      toast("تعذّر النسخ", "error");
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="shrink-0 text-xs text-slate-500">{label}</span>
        <code className="truncate font-mono text-sm font-bold tracking-wider text-slate-800" dir="ltr">
          {password}
        </code>
      </div>
      <button
        onClick={copy}
        title="نسخ"
        className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent/10"
      >
        <Copy className="h-3.5 w-3.5" />
        نسخ
      </button>
    </div>
  );
}

// Publish entry point: shows the scheduled audience + the exam password, then
// publishes the exam to those students (POST /exams/{id}/publish).
function PublishDialog({
  exam,
  groups,
  onClose,
  onDone,
}: {
  exam: Exam;
  groups: Group[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);
  const scheduledGroups = exam.group_ids
    .map((id) => groups.find((g) => g.id === id))
    .filter((g): g is Group => !!g);

  async function publish() {
    setPublishing(true);
    try {
      await api.post(`/exams/${exam.id}/publish`, {});
      toast(exam.published ? "تم تحديث النشر" : "تم نشر الاختبار للطلاب");
      onDone();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "تعذّر النشر", "error");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Modal
      title="نشر الاختبار"
      subtitle={exam.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 font-medium text-slate-600 hover:bg-slate-50">
            إغلاق
          </button>
          <button
            type="button"
            onClick={publish}
            disabled={publishing || !exam.complete}
            className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 font-medium text-white hover:bg-green-700 disabled:opacity-60"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {exam.published ? "إعادة النشر" : "نشر"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          <CalendarClock className="h-4 w-4 shrink-0 text-accent" />
          موعد الاختبار:
          <span className="font-medium text-slate-800" dir="ltr">{exam.scheduled_date}</span>
        </div>

        {exam.group_passwords.length > 0 && (
          <GroupPasswords
            passwords={exam.group_passwords}
            groupsById={new Map(groups.map((g) => [g.id, g]))}
          />
        )}

        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Users className="h-4 w-4" />
            المجموعات المقرّر لها الاختبار
          </div>
          {scheduledGroups.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">لا توجد مجموعات.</p>
          ) : (
            <ul className="space-y-1.5">
              {scheduledGroups.map((g) => (
                <li key={g.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  {groupLabel(g)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-green-50 p-3 text-xs text-green-700">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          عند النشر يظهر الاختبار فورًا لطلاب المجموعات المحددة ويصلهم إشعار داخل التطبيق.
        </div>
      </div>
    </Modal>
  );
}

function ScheduleDialog({
  exam,
  groups,
  onClose,
  onDone,
}: {
  exam: Exam;
  groups: Group[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [groupIds, setGroupIds] = useState<string[]>(exam.group_ids);
  const [date, setDate] = useState(exam.scheduled_date ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const options = groups
    .filter((g) => g.grade === exam.grade && g.is_active)
    .map((g) => ({ value: g.id, label: groupLabel(g) }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (groupIds.length === 0) return setError("اختر مجموعة واحدة على الأقل.");
    if (!date) return setError("اختر تاريخ الاختبار.");
    // Never allow scheduling in the past.
    if (date < todayIso()) return setError("لا يمكن اختيار تاريخ سابق. اختر تاريخ اليوم أو تاريخًا لاحقًا.");
    setSaving(true);
    try {
      await api.post(`/exams/${exam.id}/schedule`, { group_ids: groupIds, date });
      toast("تم جدولة الاختبار");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذّرت الجدولة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="جدولة الاختبار"
      subtitle={exam.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 font-medium text-slate-600 hover:bg-slate-50">
            إلغاء
          </button>
          <button type="submit" form="schedule-form" disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="schedule-form" noValidate onSubmit={submit} className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">المجموعات</label>
          {options.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">لا توجد مجموعات لهذا الصف.</p>
          ) : (
            <MultiSelect value={groupIds} onChange={setGroupIds} options={options} placeholder="اختر المجموعات" />
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">تاريخ الاختبار</label>
          <input
            type="date"
            dir="ltr"
            min={todayIso()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
        {error && <FormNotice message={error} />}
      </form>
    </Modal>
  );
}
