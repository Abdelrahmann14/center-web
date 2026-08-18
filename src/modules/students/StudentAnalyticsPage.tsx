import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  CalendarX2,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Percent,
  Send,
  TrendingUp,
  XCircle,
} from "@/components/icons";
import { api, ApiError, getFile } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { Modal } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { THEAD } from "@/components/tableStyles";
import { useAuth } from "@/auth/AuthContext";
import { useOnline } from "@/lib/useOnline";
import { homeworkLabel } from "@/lib/homework";

interface Summary {
  first_attendance: string | null;
  last_attendance: string | null;
  attended_lessons: number;
  missed_lessons: number;
  attendance_percent: number | null;
  exams_taken: number;
  exams_missed: number;
  average_exam_percent: number | null;
  best_exam_percent: number | null;
  worst_exam_percent: number | null;
  homework_issues: number;
  current_streak: number;
  longest_streak: number;
}

interface Entry {
  lecture_id: string;
  lecture_name: string;
  date: string | null;
  attended_at: string | null;
  group_name: string | null;
  attended: boolean;
  exam_name: string | null;
  exam_taken: boolean;
  exam_score: number | null;
  exam_max_score: number | null;
  exam_percent: number | null;
  homework_flag: string | null;
}

interface Analytics {
  has_data: boolean;
  summary: Summary | null;
  timeline: Entry[];
}

/** The student's name and parent phone, for the header and the send actions. */
interface StudentLite {
  name: string;
  grade: string | null;
  parent_phones: string[];
  student_phones: string[];
}

const arNum = (n: number) => n.toLocaleString("ar-EG");
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ar-EG", { dateStyle: "short" }) : "-";
/** Attendance is logged to the second, so the seconds are shown. */
const fmtClock = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("ar-EG", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "-";
const pct = (v?: number | null) => (v == null ? "-" : `${arNum(v)}%`);

export default function StudentAnalyticsPage() {
  const { studentId = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<Analytics | null>(null);
  const [student, setStudent] = useState<StudentLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  // The report is generated, downloaded and sent server-side - none of it works
  // offline, so the whole export entry is shut off with no connection.
  const online = useOnline();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get<Analytics>(`/students/${studentId}/analytics`),
      api.get<StudentLite>(`/students/${studentId}`),
    ])
      .then(([a, s]) => {
        if (cancelled) return;
        setData(a);
        setStudent(s);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof ApiError ? err.message : "تعذّر تحميل تحليلات الطالب");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const back = (
    <button
      onClick={() => navigate("/students")}
      className="flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
    >
      <ArrowRight className="h-4 w-4" />
      العودة إلى الطلاب
    </button>
  );

  if (loading) return <LoaderBlock />;

  const summary = data?.summary;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-800">
            تحليلات {student?.name ?? "الطالب"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {data?.has_data && (
            <button
              onClick={() => setExportOpen(true)}
              disabled={!online}
              title={!online ? "لا يوجد اتصال بالإنترنت" : undefined}
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
            >
              <FileText className="h-4 w-4" />
              تصدير PDF
            </button>
          )}
          {back}
        </div>
      </div>

      {!data?.has_data ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
          <CalendarX2 className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="font-medium text-slate-600">لا يوجد سجل حضور لهذا الطالب بعد</p>
          <p className="mt-1 text-sm text-slate-400">
            تبدأ التحليلات من أول حصة يحضرها الطالب.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="الحصص المحضورة"
              value={arNum(summary!.attended_lessons)}
              tone="ok"
            />
            <Stat
              icon={<XCircle className="h-5 w-5" />}
              label="الحصص الغائبة"
              value={arNum(summary!.missed_lessons)}
              tone="bad"
            />
            <Stat
              icon={<Percent className="h-5 w-5" />}
              label="نسبة الحضور"
              value={pct(summary!.attendance_percent)}
            />
            <Stat
              icon={<TrendingUp className="h-5 w-5" />}
              label="متوسط الاختبارات"
              value={pct(summary!.average_exam_percent)}
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Mini label="اختبارات أُدّيت" value={arNum(summary!.exams_taken)} />
            <Mini label="اختبارات فائتة" value={arNum(summary!.exams_missed)} />
            <Mini label="أعلى درجة" value={pct(summary!.best_exam_percent)} />
            <Mini label="أقل درجة" value={pct(summary!.worst_exam_percent)} />
            <Mini label="أول حضور" value={fmtDate(summary!.first_attendance)} />
            <Mini label="آخر حضور" value={fmtDate(summary!.last_attendance)} />
            <Mini label="أطول التزام متصل" value={arNum(summary!.longest_streak)} />
            <Mini label="ملاحظات الواجب" value={arNum(summary!.homework_issues)} />
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-right text-sm">
                <thead className={THEAD}>
                  <tr>
                    <th className="px-5 py-3 font-medium">#</th>
                    <th className="px-5 py-3 font-medium">الحصة</th>
                    <th className="px-5 py-3 font-medium">التاريخ</th>
                    <th className="px-5 py-3 font-medium">وقت الحضور</th>
                    <th className="px-5 py-3 font-medium">المجموعة</th>
                    <th className="px-5 py-3 font-medium">الحالة</th>
                    <th className="px-5 py-3 font-medium">الاختبار</th>
                    <th className="px-5 py-3 font-medium">الدرجة</th>
                    <th className="px-5 py-3 font-medium">الواجب</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.timeline.map((e, i) => (
                    <tr
                      key={`${e.lecture_id}-${i}`}
                      className={e.attended ? "" : "bg-rose-50/40"}
                    >
                      <td className="px-5 py-3 text-slate-400">{arNum(i + 1)}</td>
                      <td className="px-5 py-3 font-medium text-slate-800">{e.lecture_name}</td>
                      <td className="px-5 py-3 whitespace-nowrap text-slate-600">{fmtDate(e.date)}</td>
                      <td className="px-5 py-3 whitespace-nowrap tabular-nums text-slate-600">
                        {fmtClock(e.attended_at)}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{e.group_name ?? "-"}</td>
                      <td className="px-5 py-3">
                        {e.attended ? (
                          <span className="rounded-md bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                            حاضر
                          </span>
                        ) : (
                          <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                            غائب
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{e.exam_name ?? "-"}</td>
                      <td className="px-5 py-3 tabular-nums text-slate-700">
                        {e.exam_score == null
                          ? "-"
                          : `${arNum(e.exam_score)}${
                              e.exam_max_score != null ? ` / ${arNum(e.exam_max_score)}` : ""
                            }`}
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        {homeworkLabel(e.homework_flag) || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {exportOpen && (
        <ExportDialog
          studentId={studentId}
          studentName={student?.name ?? ""}
          hasParentPhone={(student?.parent_phones?.length ?? 0) > 0}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "ok" | "bad";
}) {
  const color =
    tone === "ok" ? "text-green-600" : tone === "bad" ? "text-rose-600" : "text-accent";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`flex items-center gap-2 ${color}`}>
        {icon}
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-slate-800">{value}</div>
    </div>
  );
}

/**
 * Generates the report, then offers the two things anyone actually does with
 * it: keep a copy, or send it to the guardian. Sending is disabled when no
 * parent phone is on file.
 */
function ExportDialog({
  studentId,
  studentName,
  hasParentPhone,
  onClose,
}: {
  studentId: string;
  studentName: string;
  hasParentPhone: boolean;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"parent" | "download" | null>(null);
  // Downloading the report is part of viewing it; messaging it out is its own
  // permission, so an assistant can read the record without contacting anyone.
  const { can } = useAuth();
  const canSend = can("STUDENT_REPORT_SEND");
  const online = useOnline();

  async function download() {
    setBusy("download");
    try {
      const { blob, fileName } = await getFile(`/students/${studentId}/analytics/report`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // The server names the file after the student; this is only the fallback.
      a.download = fileName ?? `تقرير - ${studentName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("تم تنزيل التقرير");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر تنزيل التقرير");
    } finally {
      setBusy(null);
    }
  }

  async function sendToParent() {
    setBusy("parent");
    try {
      await api.post(`/students/${studentId}/analytics/report/send/parent`);
      toast.success("تم إرسال التقرير لولي الأمر");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر إرسال التقرير");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      title="تصدير التقرير"
      subtitle={studentName}
      onClose={onClose}
      footer={
        <button
          onClick={onClose}
          className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
        >
          إغلاق
        </button>
      }
    >
      <p className="text-sm text-slate-500">
        يتضمّن التقرير بيانات الطالب وتحليلات حضوره ودرجاته.
      </p>
      <div className="space-y-2">
        {/* Two choices only: keep it, or send it to the guardian. The report
            carries attendance and grades - it is written for whoever is
            responsible for the student, not for the student. The server still
            exposes a send-to-student route; nothing in the UI points at it. */}
        {canSend && (
          <Action
            icon={<Send className="h-5 w-5" />}
            label="إرسال إلى ولي الأمر"
            hint={
              !online
                ? "لا يوجد اتصال بالإنترنت"
                : hasParentPhone
                  ? "عبر واتساب"
                  : "لا يوجد رقم هاتف لولي الأمر"
            }
            disabled={!hasParentPhone || !online}
            busy={busy === "parent"}
            onClick={sendToParent}
          />
        )}
        <Action
          icon={<Download className="h-5 w-5" />}
          label="تنزيل الملف"
          hint={online ? "يُحفظ باسم الطالب" : "لا يوجد اتصال بالإنترنت"}
          disabled={!online}
          busy={busy === "download"}
          onClick={download}
        />
      </div>
    </Modal>
  );
}

function Action({
  icon,
  label,
  hint,
  disabled,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-right transition enabled:hover:border-accent enabled:hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="text-accent">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}</span>
      <span className="flex-1">
        <span className="block font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
    </button>
  );
}
