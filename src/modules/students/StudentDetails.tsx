import { useState, type ReactNode } from "react";
import { Ban, Coins, Loader2, Send } from "@/components/icons";
import { Modal } from "@/components/ui";
import { AuditCell } from "@/components/AuditCell";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { useAuth } from "@/auth/AuthContext";
import { useOnline } from "@/lib/useOnline";
import { groupLabel, type Student, type Group } from "./StudentForm";

/**
 * Read-only view of every field a student carries - including the ones the table
 * no longer shows (app registration, Google sync, city, religion, track, notes,
 * discount reason). Opened by clicking a row in the students table.
 */
export function StudentDetails({
  student,
  groups,
  hasMobileApp,
  onClose,
}: {
  student: Student;
  groups: Group[];
  /** The app column only means something for a workspace with the mobile app. */
  hasMobileApp: boolean;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const canSend = can("STUDENT_REPORT_SEND");
  const online = useOnline();
  const [sending, setSending] = useState(false);
  const group = student.group_id ? groups.find((g) => g.id === student.group_id) : undefined;
  const hasStudentPhone = student.student_phones.length > 0;

  async function sendBarcode() {
    setSending(true);
    try {
      await api.post(`/students/${student.id}/barcode/send`);
      toast.success("تم إرسال الباركود للطالب عبر واتساب");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر إرسال الباركود");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      size="3xl"
      title={student.name}
      subtitle={`كود الطالب: ${student.serial}`}
      onClose={onClose}
      footer={
        <>
          {canSend && (
            <button
              type="button"
              onClick={sendBarcode}
              disabled={sending || !hasStudentPhone || !online}
              title={
                !online
                  ? "لا يوجد اتصال بالإنترنت"
                  : hasStudentPhone
                    ? "إرسال الباركود عبر واتساب"
                    : "لا يوجد رقم هاتف للطالب"
              }
              className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              إرسال الباركود
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            إغلاق
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Info label="الصف" value={student.grade} />
        <Info label="المجموعة" value={group ? groupLabel(group) : null} className="col-span-2 sm:col-span-2" />
        <Info label="المدرسة" value={student.school} />
        <Info label="المنطقة السكنية" value={student.city} />
        <Info label="النوع" value={student.gender} />
        <Info label="الديانة" value={student.religion} />
        <Info label="الشعبة" value={student.academic_track} />

        <Info label="سعر الحصة" value={<PriceValue student={student} />} />
        {student.is_discounted && (
          <Info
            label="سبب الخصم"
            value={student.discount_reason}
            className="col-span-2 sm:col-span-3"
          />
        )}

        <Phones label="هاتف الطالب" phones={student.student_phones} />
        <Phones label="هاتف ولي الأمر" phones={student.parent_phones} />

        <Info
          label="الحالة"
          value={
            student.is_active ? (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" />
                نشط
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-medium text-rose-700">
                <Ban className="h-3.5 w-3.5 shrink-0" />
                محظور
              </span>
            )
          }
        />
        {!student.is_active && (
          <Info label="سبب الحظر" value={student.block_reason} className="col-span-2" />
        )}

        {hasMobileApp && (
          <Info
            label="التطبيق"
            value={
              <Badge on={student.registered} onLabel="مُسجَّل" offLabel="غير مُسجَّل" />
            }
          />
        )}
        <Info
          label="مزامنة Google"
          value={<Badge on={student.google_synced} onLabel="مُزامَن" offLabel="غير مُزامَن" />}
        />

        <Info label="ملاحظات" value={student.notes} className="col-span-2 sm:col-span-3" />

        <div className="col-span-2 sm:col-span-3 mt-1 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
          <div>
            <FieldLabel>أنشئ في</FieldLabel>
            <AuditCell at={student.created_at} by={student.created_by} />
          </div>
          <div>
            <FieldLabel>آخر تحديث</FieldLabel>
            <AuditCell at={student.updated_at} by={student.updated_by} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1.5 text-sm font-semibold text-slate-700">{children}</div>;
}

function Info({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  const empty = value == null || value === "";
  return (
    <div className={className}>
      <FieldLabel>{label}</FieldLabel>
      <div className="min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-800">
        <span className={empty ? "text-slate-400" : ""}>{empty ? "-" : value}</span>
      </div>
    </div>
  );
}

function Phones({ label, phones }: { label: string; phones: string[] }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="min-h-[42px] rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-slate-800" dir="ltr">
        {phones.length ? (
          <div className="space-y-0.5 text-right tabular-nums">
            {phones.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        ) : (
          <span className="text-slate-400">-</span>
        )}
      </div>
    </div>
  );
}

function PriceValue({ student }: { student: Student }) {
  if (student.lesson_price == null) return <span className="text-slate-400">-</span>;
  if (student.lesson_price === 0) {
    return (
      <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">
        معفي
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1 tabular-nums">
        {student.lesson_price}
        <Coins className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      </span>
      {student.is_discounted && (
        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
          مُخَفَّض
        </span>
      )}
    </span>
  );
}

function Badge({ on, onLabel, offLabel }: { on: boolean; onLabel: string; offLabel: string }) {
  return on ? (
    <span className="rounded-md bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">
      {onLabel}
    </span>
  ) : (
    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
      {offLabel}
    </span>
  );
}
