import { type ReactNode } from "react";
import { AlertTriangle, Ban, Coins } from "@/components/icons";
import { Modal } from "@/components/ui";
import { AuditCell } from "@/components/AuditCell";
import { fmtDate } from "@/lib/datetime";
import { groupLabel, type Student, type Group, type Grade } from "./StudentForm";
import { missingStudentFields, STUDENT_FIELD_LABEL } from "./incompleteFields";

/**
 * Read-only view of every field a student carries - including the ones the table
 * no longer shows (Google sync, city, religion, track, notes,
 * discount reason). Opened by clicking a row in the students table.
 */
export function StudentDetails({
  student,
  groups,
  grades,
  onClose,
}: {
  student: Student;
  groups: Group[];
  grades: Grade[];
  onClose: () => void;
}) {
  const group = student.group_id ? groups.find((g) => g.id === student.group_id) : undefined;
  // Exactly which required fields are still missing, so each one is marked amber
  // (and named up top) rather than only tinting the whole row on the table.
  const missing = missingStudentFields(student, grades);

  return (
    <Modal
      size="3xl"
      title={student.name}
      subtitle={`كود الطالب: ${student.serial}`}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
        >
          إغلاق
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {missing.size > 0 && (
          <div className="col-span-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:col-span-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="font-semibold">بيانات ناقصة: </span>
              {Array.from(missing)
                .map((f) => STUDENT_FIELD_LABEL[f])
                .join("، ")}
            </span>
          </div>
        )}
        <Info label="الصف" value={student.grade} missing={missing.has("grade")} />
        <Info
          label="المجموعة"
          value={group ? groupLabel(group) : null}
          missing={missing.has("group")}
          className="col-span-2 sm:col-span-2"
        />
        <Info label="المدرسة" value={student.school} missing={missing.has("school")} />
        <Info label="المنطقة السكنية" value={student.city} missing={missing.has("city")} />
        <Info label="النوع" value={student.gender} missing={missing.has("gender")} />
        <Info label="الديانة" value={student.religion} />

        <Info label="سعر الحصة" value={<PriceValue student={student} />} />
        {student.is_discounted && (
          <Info
            label="سبب الخصم"
            value={student.discount_reason}
            className="col-span-2 sm:col-span-3"
          />
        )}

        <Phones
          label="هاتف الطالب"
          phones={student.student_phones}
          missing={missing.has("student_phones")}
        />
        <Phones
          label="هاتف ولي الأمر"
          phones={student.parent_phones}
          missing={missing.has("parent_phones")}
        />

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

        <Info
          label="مزامنة Google"
          value={<Badge on={student.google_synced} onLabel="مُزامَن" offLabel="غير مُزامَن" />}
        />

        {/* The date, not just a yes: "sent" is only reassuring if it was sent
            recently enough to be the card the student is actually carrying. */}
        <Info
          label="كارت الباركود"
          value={
            <Badge
              on={!!student.barcode_sent_at}
              onLabel={`أُرسل في ${fmtDate(student.barcode_sent_at)}`}
              offLabel="لم يُرسل"
            />
          }
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

function FieldLabel({ children, missing = false }: { children: ReactNode; missing?: boolean }) {
  return (
    <div className={`mb-1.5 text-sm font-semibold ${missing ? "text-amber-700" : "text-slate-700"}`}>
      {children}
    </div>
  );
}

// The control box: amber border + fill when the field is a still-missing part of
// the record, the neutral slate otherwise.
const boxClass = (missing: boolean) =>
  `min-h-[42px] rounded-xl border px-4 py-2.5 text-slate-800 ${
    missing ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"
  }`;

function Info({
  label,
  value,
  missing = false,
  className = "",
}: {
  label: string;
  value: ReactNode;
  missing?: boolean;
  className?: string;
}) {
  const empty = value == null || value === "";
  return (
    <div className={className}>
      <FieldLabel missing={missing}>{label}</FieldLabel>
      <div className={boxClass(missing)}>
        <span className={empty ? "text-slate-400" : ""}>{empty ? "-" : value}</span>
      </div>
    </div>
  );
}

function Phones({
  label,
  phones,
  missing = false,
}: {
  label: string;
  phones: string[];
  missing?: boolean;
}) {
  return (
    <div>
      <FieldLabel missing={missing}>{label}</FieldLabel>
      <div className={boxClass(missing)} dir="ltr">
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
