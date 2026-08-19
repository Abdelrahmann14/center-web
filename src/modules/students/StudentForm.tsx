import { useEffect, useState } from "react";
import { Plus, Loader2, X, Check, AlertTriangle } from "@/components/icons";
import { api, ApiError, isOfflineError, qs } from "@/lib/api";
import { dayLabel } from "@/lib/days";
import { fmtTime } from "@/lib/datetime";
import { useDebounced } from "@/lib/useDebounced";
import { useOnline } from "@/lib/useOnline";
import { useSync } from "@/sync/SyncProvider";
import { useWhatsappCheck, type WaStatus } from "@/lib/useWhatsappCheck";
import { NAME_MIN_PARTS, nameParts, isFullName } from "@/lib/studentName";
import { RELIGIONS, GENDERS, type TrackKind } from "@/lib/tracks";
import { Modal, Field, Select, FieldError, FormNotice, AutocompleteInput, advanceOnEnter, inputClass } from "@/components/ui";
import { useToast } from "@/components/Toast";

export const MAX_PHONES = 3;
export const MIN_DIGITS = 11;
export const digitsOnly = (p: string) => p.replace(/\D/g, "");

// Name: Arabic letters + single internal spaces only.
const sanitizeName = (v: string) =>
  v.replace(/[^ء-ي\s]/g, "").replace(/^\s+/, "").replace(/\s{2,}/g, " ");

export interface Grade {
  id: string;
  name: string;
  is_active: boolean;
  track_kind: TrackKind;
}

export interface Group {
  id: string;
  day_of_week: number;
  start_time: string;
  center_name: string;
  grade: string;
  is_active: boolean;
  deleted?: boolean;
  lesson_price: number | null;
}

export interface Student {
  id: string;
  serial: number;
  name: string;
  grade: string | null;
  school: string | null;
  city: string | null;
  gender: string | null;
  group_id: string | null;
  student_phones: string[];
  parent_phones: string[];
  religion: string | null;
  academic_track: string | null;
  lesson_price: number | null;
  is_discounted: boolean;
  /** Why the student pays below the center's price; null at full price. */
  discount_reason: string | null;
  notes: string | null;
  is_active: boolean;
  /** Why the student is blocked; null while they are active. */
  block_reason: string | null;
  registered: boolean;
  google_synced: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export const groupLabel = (g: Group) =>
  `${dayLabel(g.day_of_week)} · ${fmtTime(g.start_time)} · ${g.center_name}`;

function WhatsappTag({ status }: { status?: WaStatus }) {
  if (!status || status === "unknown") return null;
  if (status === "checking") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        جارٍ التحقق من واتساب…
      </span>
    );
  }
  if (status === "yes") {
    return (
      <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
        <Check className="h-3.5 w-3.5" />
        مسجل على الواتساب
      </span>
    );
  }
  return (
    <span className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
      <AlertTriangle className="h-3.5 w-3.5" />
      غير مسجل على الواتساب
    </span>
  );
}

function PhoneList({
  label,
  phones,
  setPhones,
  errors,
  statuses,
  incomplete = false,
  onFocus,
  onBlur,
}: {
  label: string;
  phones: string[];
  setPhones: (p: string[]) => void;
  errors: (string | null)[];
  statuses?: (WaStatus | undefined)[];
  /** Amber-marks empty numbers as a still-missing required field. */
  incomplete?: boolean;
  onFocus?: () => void;
  /** Reports that the user has left this number, so its error may show. */
  onBlur?: (index: number) => void;
}) {
  const update = (i: number, v: string) =>
    setPhones(phones.map((p, idx) => (idx === i ? v.replace(/\D/g, "").slice(0, 11) : p)));
  const add = () => phones.length < MAX_PHONES && setPhones([...phones, ""]);
  const remove = (i: number) => setPhones(phones.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="space-y-2">
        {phones.map((p, i) => (
          <div key={i}>
            <div className="flex gap-2">
              <Field
                label={i === 0 ? label : `${label} ${(i + 1).toLocaleString("ar-EG")}`}
                filled={p !== ""}
                incomplete={incomplete && !digitsOnly(p)}
                className="flex-1"
              >
                <FieldError message={errors[i]} />
                <input
                  type="tel"
                  inputMode="numeric"
                  dir="ltr"
                  maxLength={11}
                  value={p}
                  onChange={(e) => update(i, e.target.value)}
                  onFocus={onFocus}
                  onBlur={() => onBlur?.(i)}
                  required={i === 0}
                  className={`${inputClass} ${errors[i] ? "border-rose-400 focus:border-rose-400 focus:ring-rose-200" : ""}`}
                />
                <WhatsappTag status={statuses?.[i]} />
              </Field>
              {phones.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="shrink-0 self-start rounded-xl border border-slate-300 px-3 py-2.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}
        {phones.length < MAX_PHONES && (
          <button
            type="button"
            onClick={add}
            className="flex items-center gap-1 text-sm font-medium text-accent hover:text-accent-hover"
          >
            <Plus className="h-4 w-4" />
            إضافة رقم آخر
          </button>
        )}
      </div>
    </div>
  );
}

/** Suggestion lists + next serial, fetched once instead of loading every student. */
export interface StudentOptions {
  schools: string[];
  cities: string[];
  next_serial: number;
}

interface DuplicateCheck {
  name_taken: boolean;
  /** phone digits -> the name of the student already using it */
  phone_owners: Record<string, string>;
}

export function StudentForm({
  initial,
  grades,
  groups,
  options,
  onClose,
  onSaved,
}: {
  initial?: Student;
  grades: Grade[];
  groups: Group[];
  options: StudentOptions;
  onClose: () => void;
  onSaved: (s: Student, isEdit: boolean) => void;
}) {
  const isEdit = initial !== undefined;
  const toast = useToast();
  const sync = useSync();
  const online = useOnline();
  const activeGrades = grades.filter((g) => g.is_active || g.name === initial?.grade);
  const displaySerial = initial?.serial ?? options.next_serial;

  const [name, setName] = useState(initial?.name ?? "");
  const [grade, setGrade] = useState(initial?.grade ?? activeGrades[0]?.name ?? "");
  const [school, setSchool] = useState(initial?.school ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [gender, setGender] = useState(initial?.gender ?? GENDERS[0]);
  const [groupId, setGroupId] = useState(initial?.group_id ?? "");
  const [religion, setReligion] = useState(initial?.religion ?? RELIGIONS[0]);
  const [price, setPrice] = useState(initial?.lesson_price != null ? String(initial.lesson_price) : "");
  const [discountReason, setDiscountReason] = useState(initial?.discount_reason ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Blocking keeps the student on file; only registration is barred. New
  // students always start active.
  const [active, setActive] = useState(initial ? initial.is_active : true);
  const [blockReason, setBlockReason] = useState(initial?.block_reason ?? "");
  const [studentPhones, setStudentPhones] = useState<string[]>(
    initial?.student_phones.length ? initial.student_phones : [""]
  );
  const [parentPhones, setParentPhones] = useState<string[]>(
    initial?.parent_phones.length ? initial.parent_phones : [""]
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  /** Fields the user has entered and left. Drives the on-blur validation. */
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [allowDup, setAllowDup] = useState(false);

  // WhatsApp lookup per number - informational only. Every number shows an
  // indicator (on/off WhatsApp), but being off WhatsApp never blocks saving.
  const studentWa = useWhatsappCheck(studentPhones);
  const parentWa = useWhatsappCheck(parentPhones);
  const studentWaStatuses = studentPhones.map((p) => studentWa[digitsOnly(p)]);
  const parentWaStatuses = parentPhones.map((p) => parentWa[digitsOnly(p)]);

  // Two kinds of error, revealed at different moments.
  //
  // A CONTENT error (a name that is not four parts, a phone missing a digit, a
  // price above the center's) appears as soon as the user leaves that field, so
  // they learn about it beside the field they just filled rather than at the end.
  //
  // "مطلوب" waits for Save. Flagging an empty field the moment focus leaves it
  // would paint the form red as the user tabs through it - they have not failed
  // to fill it in, they have not reached it yet.
  const O = {
    name: 1, school: 2, city: 3, grade: 4, group: 6,
    gender: 7, religion: 8, price: 9, discount: 10, sphone: 11, pphone: 12, notes: 13,
  };
  const touch = (key: string) => setTouched((t) => (t[key] ? t : { ...t, [key]: true }));
  const showContent = (key: string) => touched[key] === true || attempted;
  const req = (_o: number, v: string) => (attempted && !v.trim() ? "مطلوب" : null);

  const groupOptions = groups.filter((g) => g.grade === grade && !g.deleted);

  const selectedGroup = groups.find((g) => g.id === groupId);
  const centerPrice = selectedGroup?.lesson_price ?? null;
  const priceNum = price === "" ? null : Number(price);
  const priceErrorRaw =
    centerPrice != null && priceNum != null && priceNum > centerPrice
      ? "لا يمكن أن يكون السعر أعلى من سعر السنتر"
      : null;
  const discounted = centerPrice != null && priceNum != null && priceNum < centerPrice;

  // Duplicates are checked on the server: with pagination the client no longer
  // holds every student, and the whole table is far too much to pull into a
  // form. The create/update endpoints enforce the same rules regardless.
  const [dup, setDup] = useState<DuplicateCheck>({ name_taken: false, phone_owners: {} });

  const checkableDigits = studentPhones.map(digitsOnly).filter((d) => d.length >= MIN_DIGITS);
  const dupKey = useDebounced(JSON.stringify([name.trim(), checkableDigits]));

  useEffect(() => {
    const [checkName, phones] = JSON.parse(dupKey) as [string, string[]];
    if (!checkName && phones.length === 0) {
      setDup({ name_taken: false, phone_owners: {} });
      return;
    }
    let cancelled = false;
    api
      .get<DuplicateCheck>(
        `/students/duplicates${qs({
          name: checkName,
          phones: phones.join(","),
          exclude_id: initial?.id,
        })}`
      )
      // A stale in-flight check must not overwrite a newer one.
      .then((res) => !cancelled && setDup(res))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dupKey, initial?.id]);

  const phoneOwnerOf = (digits: string): string | undefined => dup.phone_owners[digits];

  const schoolSuggestions = options.schools;
  const citySuggestions = options.cities;

  // Two parts save; four is the complete Egyptian name. A short name is no
  // longer an error - it used to be, and the only way past was to invent a word,
  // which is worse data than a genuinely short name. It is a NOTE instead, and
  // the record shows as "بيانات ناقصة" on the students page until it is filled in.
  const parts = nameParts(name);
  const nameErrorRaw = name.trim()
    ? dup.name_taken
      ? "الاسم مستخدم لطالب آخر"
      : parts < NAME_MIN_PARTS
        ? "اكتب اسم الطالب من مقطعين على الأقل"
        : null
    : null;
  const nameError = nameErrorRaw ? (showContent("name") ? nameErrorRaw : null) : req(O.name, name);

  // A discount needs a reason, but any text - no minimum length.
  const discountReasonErrorRaw =
    discounted && !discountReason.trim() ? "اذكر سبب الخصم" : null;
  const discountReasonError = showContent("discount") ? discountReasonErrorRaw : null;
  const priceError = showContent("price") ? priceErrorRaw : null;

  const spAllEmpty = studentPhones.every((p) => !digitsOnly(p));
  const ppAllEmpty = parentPhones.every((p) => !digitsOnly(p));

  const studentPhoneRaw = studentPhones.map((p, i) => {
    const d = digitsOnly(p);
    if (!d) return i === 0 && spAllEmpty ? "مطلوب" : null;
    if (d.length !== MIN_DIGITS) return `${MIN_DIGITS} أرقام`;
    if (phoneOwnerOf(d)) return allowDup ? null : `الرقم مستخدم لـ ${phoneOwnerOf(d)}`;
    if (studentPhones.filter((x) => digitsOnly(x) === d).length > 1) return "رقم مكرر";
    return null;
  });
  const parentPhoneRaw = parentPhones.map((p, i) => {
    const d = digitsOnly(p);
    if (!d) return i === 0 && ppAllEmpty ? "مطلوب" : null;
    if (d.length !== MIN_DIGITS) return `${MIN_DIGITS} أرقام`;
    if (parentPhones.filter((x) => digitsOnly(x) === d).length > 1) return "رقم مكرر";
    // WhatsApp is NOT required: a number off WhatsApp still saves. The tag under
    // the field just says so; it never blocks the form.
    return null;
  });
  // "مطلوب" on the first number still waits for Save; anything else about a
  // number the user has typed and left shows straight away.
  const phoneError = (raw: string | null, key: string) => {
    if (raw === null) return null;
    if (raw === "مطلوب") return attempted ? raw : null;
    return showContent(key) ? raw : null;
  };
  const studentPhoneErrors = studentPhoneRaw.map((e, i) => phoneError(e, `sphone${i}`));
  const parentPhoneErrors = parentPhoneRaw.map((e, i) => phoneError(e, `pphone${i}`));

  const hasDupOwner = studentPhones.some((p) => {
    const d = digitsOnly(p);
    return d.length >= MIN_DIGITS && !!phoneOwnerOf(d);
  });
  // The other student(s) already holding a number typed here, named so the
  // confirm checkbox says exactly whose number this is.
  const dupOwnerNames = Array.from(
    new Set(
      studentPhones
        .map((p) => phoneOwnerOf(digitsOnly(p)))
        .filter((n): n is string => !!n),
    ),
  );

  // Which required fields are still missing, shown as an amber halo on each one
  // while EDITING an existing record (a blank add form would otherwise light up
  // entirely). Mirrors the students-page "بيانات ناقصة" rule field-by-field.
  const mark = (missing: boolean) => isEdit && missing;
  const nameIncomplete = mark(!!name.trim() && !isFullName(name));
  const schoolIncomplete = mark(!school.trim());
  const cityIncomplete = mark(!city.trim());
  const gradeIncomplete = mark(!grade);
  const groupIncomplete = mark(!groupId);
  const sPhonesIncomplete = mark(spAllEmpty);
  const pPhonesIncomplete = mark(ppAllEmpty);

  function reset() {
    setName("");
    setGrade(activeGrades[0]?.name ?? "");
    setSchool("");
    setCity("");
    setGender(GENDERS[0]);
    setGroupId("");
    setReligion(RELIGIONS[0]);
    setPrice("");
    setDiscountReason("");
    setNotes("");
    setStudentPhones([""]);
    setParentPhones([""]);
    setAttempted(false);
    setTouched({});
    setAllowDup(false);
  }

  function onGradeChange(newGrade: string) {
    setGrade(newGrade);
    setGroupId("");
    setPrice("");
  }

  function onGroupChange(id: string) {
    setGroupId(id);
    const g = groups.find((x) => x.id === id);
    setPrice(g?.lesson_price != null ? String(g.lesson_price) : "");
  }

  const realPhoneErr = (e: string | null) => !!e && e !== "مطلوب";
  const hasFieldErrors =
    !!nameErrorRaw ||
    !!priceErrorRaw ||
    !!discountReasonErrorRaw ||
    studentPhoneRaw.some(realPhoneErr) ||
    parentPhoneRaw.some(realPhoneErr);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAttempted(true);

    const sp = studentPhones.map(digitsOnly).filter(Boolean);
    const pp = parentPhones.map(digitsOnly).filter(Boolean);
    const missing =
      !name.trim() ||
      !school.trim() ||
      !city.trim() ||
      !gender ||
      !grade ||
      !groupId ||
      sp.length === 0 ||
      pp.length === 0;
    if (missing || hasFieldErrors) return;

    const payload = {
      name: name.trim(),
      grade,
      school: school.trim(),
      city: city.trim(),
      gender,
      group_id: groupId,
      student_phones: sp,
      parent_phones: pp,
      religion,
      academic_track: null,
      lesson_price: priceNum,
      discount_reason: discounted ? discountReason.trim() : null,
      notes: notes.trim() || null,
      is_active: active,
      block_reason: active ? null : blockReason.trim() || null,
      allow_duplicate_phone: allowDup,
    };

    // The optimistic record shown at once and mirrored locally when offline. The
    // server assigns the real serial on sync (this is the best guess meanwhile),
    // and keeps the client's id, so the row the user saw becomes the server row.
    const now = new Date().toISOString();
    const optimistic: Record<string, unknown> = {
      id: initial?.id ?? "",
      serial: displaySerial,
      name: payload.name,
      grade,
      school: payload.school,
      city: payload.city,
      gender,
      group_id: groupId,
      student_phones: sp,
      parent_phones: pp,
      religion,
      academic_track: payload.academic_track,
      lesson_price: priceNum,
      is_discounted: discounted,
      discount_reason: payload.discount_reason,
      notes: payload.notes,
      is_active: active,
      block_reason: payload.block_reason,
      registered: initial?.registered ?? false,
      google_synced: initial?.google_synced ?? false,
      created_at: initial?.created_at ?? now,
      created_by: initial?.created_by ?? null,
      updated_at: now,
      updated_by: null,
    };

    // Queue the create/edit locally and show it immediately - it replays to the
    // server (same validation + duplicate rules) once the connection is back.
    async function saveOffline() {
      const saved = (await sync.queueStudent(
        payload,
        optimistic,
        isEdit ? initial!.id : undefined,
      )) as unknown as Student;
      onSaved(saved, isEdit);
      if (isEdit) {
        toast(`تم تحديث بيانات "${saved.name}" - بانتظار المزامنة`);
        onClose();
      } else {
        reset();
        toast(`تمت إضافة "${saved.name}" - بانتظار المزامنة عند عودة الاتصال`);
      }
    }

    setSaving(true);
    try {
      // Offline the request would hang on a dead connection before failing, so
      // queue straight away instead of waiting for it to time out.
      if (!online && sync.ready) {
        await saveOffline();
        return;
      }
      const saved = isEdit
        ? await api.put<Student>(`/students/${initial.id}`, payload)
        : await api.post<Student>("/students", payload);
      onSaved(saved, isEdit);
      if (isEdit) {
        toast(`تم تحديث بيانات "${saved.name}"`);
        onClose();
      } else {
        reset();
        toast(`تمت إضافة "${saved.name}"`);
      }
    } catch (err) {
      // The request never reached the server (offline / connection dropped):
      // queue it rather than showing a misleading error like a permission denial.
      if (isOfflineError(err) && sync.ready) {
        try {
          await saveOffline();
        } catch {
          setError("تعذّر حفظ الطالب دون اتصال");
        }
      } else {
        setError(err instanceof ApiError ? err.message : "تعذّر حفظ الطالب");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      size="3xl"
      /* The student's number belongs beside the heading, not inside the name
         field: it is what this record IS, not something being typed into it.
         Drawn as a tinted plate in the brand navy rather than a solid chip -
         it is a fact about the record, not a warning. */
      title={
        <span className="flex flex-wrap items-center gap-2.5">
          {isEdit ? "تعديل طالب" : "إضافة طالب"}
          <span className="font-ledger rounded-lg border border-dark/15 bg-dark/8 px-2.5 py-1 text-sm font-semibold text-dark/75">
            {displaySerial}
          </span>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            إغلاق
          </button>
          {/* Never disabled by validation: pressing Save is what reveals the
              required-field errors. handleSubmit blocks the actual create. */}
          <button
            type="submit"
            form="student-form"
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form
        id="student-form"
        noValidate
        onSubmit={handleSubmit}
        onKeyDown={advanceOnEnter}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="sm:col-span-2 lg:col-span-3">
          {/* No hint: the field takes Arabic letters only by construction (the
              input sanitises anything else away), and a short name is reported
              where it matters - the students page flags the record as
              "بيانات ناقصة" - rather than nagging while it is being typed. */}
          <Field label="الاسم بالكامل" filled={!!name} incomplete={nameIncomplete}>
            <FieldError message={nameError} />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(sanitizeName(e.target.value))}
              onBlur={() => touch("name")}
              required
              autoFocus
              className={`${inputClass} ${nameError ? "border-rose-400 focus:border-rose-400 focus:ring-rose-200" : ""}`}
            />
          </Field>
        </div>

        <Field label="المدرسة" filled={!!school} incomplete={schoolIncomplete}>
          <FieldError message={req(O.school, school)} />
          <AutocompleteInput
            value={school}
            onChange={setSchool}
            suggestions={schoolSuggestions}
            error={!!req(O.school, school)}
          />
        </Field>

        <Field label="المنطقة السكنية" filled={!!city} incomplete={cityIncomplete}>
          <FieldError message={req(O.city, city)} />
          <AutocompleteInput
            value={city}
            onChange={setCity}
            suggestions={citySuggestions}
            error={!!req(O.city, city)}
          />
        </Field>

        <Field
          label="الصف"
          filled={!!grade}
          incomplete={gradeIncomplete}
          hint={activeGrades.length === 0 ? "لا توجد صفوف - أضفها من لوحة المدرّس" : undefined}
        >
          <FieldError message={req(O.grade, grade)} />
          <Select
            value={grade}
            onChange={onGradeChange}
            disabled={activeGrades.length === 0}
            placeholder=""
            options={activeGrades.map((g) => ({ value: g.name, label: g.name }))}
          />
        </Field>


        <Field
          label="المجموعة"
          filled={!!groupId}
          incomplete={groupIncomplete}
          hint={groupOptions.length === 0 ? "لا توجد مجموعات لهذا الصف" : undefined}
        >
          <FieldError message={req(O.group, groupId)} />
          <Select
            value={groupId}
            onChange={onGroupChange}
            disabled={groupOptions.length === 0}
            placeholder=""
            options={groupOptions.map((g) => ({ value: g.id, label: groupLabel(g) }))}
          />
        </Field>

        <Field label="النوع" filled={!!gender}>
          <Select
            value={gender}
            onChange={setGender}
            placeholder=""
            options={GENDERS.map((g) => ({ value: g, label: g }))}
          />
        </Field>

        <Field label="الديانة" filled={!!religion}>
          <Select
            value={religion}
            onChange={setReligion}
            placeholder=""
            options={RELIGIONS.map((r) => ({ value: r, label: r }))}
          />
        </Field>

        <Field
          label="سعر الحصة"
          filled={price !== ""}
          hint={centerPrice != null ? `سعر السنتر: ${centerPrice} ج.م` : "اختر المجموعة أولاً"}
        >
          <FieldError message={priceError} />
          <input
            type="number"
            min="0"
            step="0.01"
            max={centerPrice ?? undefined}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => touch("price")}
            className={`${inputClass} ${priceError ? "border-rose-400 focus:border-rose-400 focus:ring-rose-200" : ""}`}
          />
          {priceNum === 0 ? (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
              معفي
            </span>
          ) : (
            discounted && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                مُخَفَّض
              </span>
            )
          )}
        </Field>

        {/* Appears only when the price is below the center's - a discount needs
            a reason, but any text. */}
        {discounted && (
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="سبب الخصم" filled={!!discountReason} multiline>
              <FieldError message={discountReasonError} />
              <textarea
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                onBlur={() => touch("discount")}
                rows={2}
                className={`${inputClass} ${discountReasonError ? "border-rose-400 focus:border-rose-400 focus:ring-rose-200" : ""}`}
              />
            </Field>
          </div>
        )}

        <div className="sm:col-span-2 lg:col-span-3">
          <PhoneList
            label="هاتف الطالب"
            phones={studentPhones}
            setPhones={setStudentPhones}
            errors={studentPhoneErrors}
            statuses={studentWaStatuses}
            incomplete={sPhonesIncomplete}
            onBlur={(i) => touch(`sphone${i}`)}
          />
          {hasDupOwner && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <input
                type="checkbox"
                checked={allowDup}
                onChange={(e) => setAllowDup(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-accent"
              />
              <span>
                هذا الرقم مسجّل بالفعل للطالب:{" "}
                <span className="font-semibold">{dupOwnerNames.join("، ")}</span>. حفظ الطالب رغم
                ذلك.
              </span>
            </label>
          )}
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <PhoneList
            label="هاتف ولي الأمر"
            phones={parentPhones}
            setPhones={setParentPhones}
            errors={parentPhoneErrors}
            statuses={parentWaStatuses}
            incomplete={pPhonesIncomplete}
            onBlur={(i) => touch(`pphone${i}`)}
          />
        </div>

        <Field label="حالة الطالب" filled>
          <Select
            value={active ? "active" : "blocked"}
            onChange={(v) => setActive(v === "active")}
            placeholder=""
            options={[
              { value: "active", label: "نشط" },
              { value: "blocked", label: "محظور" },
            ]}
          />
        </Field>

        {/* Only asked for when blocking, and cleared server-side on unblock. */}
        {!active && (
          <div className="sm:col-span-1 lg:col-span-2">
            <Field label="سبب الحظر" filled={!!blockReason}>
              <input
                type="text"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                maxLength={500}
                className={inputClass}
              />
            </Field>
          </div>
        )}

        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="ملاحظات" filled={!!notes} multiline>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputClass}
            />
          </Field>
        </div>

        {error && (
          <div className="sm:col-span-2 lg:col-span-3">
            <FormNotice message={error} />
          </div>
        )}
      </form>
    </Modal>
  );
}
