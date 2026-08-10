import { useEffect, useState } from "react";
import { Plus, Loader2, X, Check, AlertTriangle } from "lucide-react";
import { api, ApiError, qs } from "@/lib/api";
import { dayLabel } from "@/lib/days";
import { fmtTime } from "@/lib/datetime";
import { useDebounced } from "@/lib/useDebounced";
import { useWhatsappCheck, type WaStatus } from "@/lib/useWhatsappCheck";
import { TRACK_OPTIONS, RELIGIONS, GENDERS, type TrackKind } from "@/lib/tracks";
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
  onFocus,
}: {
  label: string;
  phones: string[];
  setPhones: (p: string[]) => void;
  errors: (string | null)[];
  statuses?: (WaStatus | undefined)[];
  onFocus?: () => void;
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
  const activeGrades = grades.filter((g) => g.is_active || g.name === initial?.grade);
  const displaySerial = initial?.serial ?? options.next_serial;

  const [name, setName] = useState(initial?.name ?? "");
  const [grade, setGrade] = useState(initial?.grade ?? activeGrades[0]?.name ?? "");
  const [school, setSchool] = useState(initial?.school ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [gender, setGender] = useState(initial?.gender ?? GENDERS[0]);
  const [groupId, setGroupId] = useState(initial?.group_id ?? "");
  const [track, setTrack] = useState(initial?.academic_track ?? "");
  const [religion, setReligion] = useState(initial?.religion ?? RELIGIONS[0]);
  const [price, setPrice] = useState(initial?.lesson_price != null ? String(initial.lesson_price) : "");
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
  const [allowDup, setAllowDup] = useState(false);
  const [reached, setReached] = useState(0);

  // WhatsApp lookup per number. Every number shows an indicator; the FIRST parent
  // number must be on WhatsApp (it receives codes), the rest are optional.
  const studentWa = useWhatsappCheck(studentPhones);
  const parentWa = useWhatsappCheck(parentPhones);
  const studentWaStatuses = studentPhones.map((p) => studentWa[digitsOnly(p)]);
  const parentWaStatuses = parentPhones.map((p) => parentWa[digitsOnly(p)]);

  const O = {
    name: 1, school: 2, city: 3, grade: 4, track: 5, group: 6,
    gender: 7, religion: 8, price: 9, sphone: 10, pphone: 11, notes: 12,
  };
  const reach = (o: number) => setReached((r) => (o > r ? o : r));
  const showFor = (o: number) => attempted || reached > o;
  const req = (o: number, v: string) => (showFor(o) && !v.trim() ? "مطلوب" : null);

  const trackKind: TrackKind = grades.find((g) => g.name === grade)?.track_kind ?? "none";
  const trackOptions = TRACK_OPTIONS[trackKind];
  const groupOptions = groups.filter((g) => g.grade === grade);

  const selectedGroup = groups.find((g) => g.id === groupId);
  const centerPrice = selectedGroup?.lesson_price ?? null;
  const priceNum = price === "" ? null : Number(price);
  const priceError =
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

  const nameErrorRaw = name.trim() && dup.name_taken ? "الاسم مستخدم لطالب آخر" : null;
  const nameError = showFor(O.name) ? nameErrorRaw ?? req(O.name, name) : null;

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
    // The first parent number must be on WhatsApp (extra numbers may not be).
    if (i === 0 && parentWa[d] === "no") return "الرقم الأول يجب أن يكون على واتساب";
    return null;
  });
  const studentPhoneErrors = studentPhoneRaw.map((e) => (showFor(O.sphone) ? e : null));
  const parentPhoneErrors = parentPhoneRaw.map((e) => (showFor(O.pphone) ? e : null));

  const hasDupOwner = studentPhones.some((p) => {
    const d = digitsOnly(p);
    return d.length >= MIN_DIGITS && !!phoneOwnerOf(d);
  });

  function reset() {
    setName("");
    setGrade(activeGrades[0]?.name ?? "");
    setSchool("");
    setCity("");
    setGender(GENDERS[0]);
    setGroupId("");
    setTrack("");
    setReligion(RELIGIONS[0]);
    setPrice("");
    setNotes("");
    setStudentPhones([""]);
    setParentPhones([""]);
    setAttempted(false);
    setReached(0);
    setAllowDup(false);
  }

  function onGradeChange(newGrade: string) {
    setGrade(newGrade);
    setTrack("");
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
    !!priceError ||
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
      (trackOptions.length > 0 && !track) ||
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
      academic_track: trackOptions.length > 0 ? track : null,
      lesson_price: priceNum,
      notes: notes.trim() || null,
      is_active: active,
      block_reason: active ? null : blockReason.trim() || null,
      allow_duplicate_phone: allowDup,
    };

    setSaving(true);
    try {
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
      setError(err instanceof ApiError ? err.message : "تعذّر حفظ الطالب");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      size="3xl"
      title={isEdit ? "تعديل طالب" : "إضافة طالب"}
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
          <button
            type="submit"
            form="student-form"
            disabled={saving || hasFieldErrors}
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
          <Field label="الاسم بالكامل" filled={!!name} hint="بالحروف العربية فقط">
            <FieldError message={nameError} />
            <input
              type="text"
              value={name}
              onChange={(e) => setName(sanitizeName(e.target.value))}
              onFocus={() => reach(O.name)}
              required
              autoFocus
              className={`${inputClass} pl-16 ${nameError ? "border-rose-400 focus:border-rose-400 focus:ring-rose-200" : ""}`}
            />
            {/* Serial rides inside the field now that the label row is gone. */}
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 rounded-md bg-rose-600 px-1.5 py-0.5 text-[11px] font-medium text-white">
              # {displaySerial}
            </span>
          </Field>
        </div>

        <Field label="المدرسة" filled={!!school}>
          <FieldError message={req(O.school, school)} />
          <AutocompleteInput
            value={school}
            onChange={setSchool}
            onFocus={() => reach(O.school)}
            suggestions={schoolSuggestions}
            error={!!req(O.school, school)}
          />
        </Field>

        <Field label="المدينة" filled={!!city}>
          <FieldError message={req(O.city, city)} />
          <AutocompleteInput
            value={city}
            onChange={setCity}
            onFocus={() => reach(O.city)}
            suggestions={citySuggestions}
            error={!!req(O.city, city)}
          />
        </Field>

        <Field
          label="الصف"
          filled={!!grade}
          hint={activeGrades.length === 0 ? "لا توجد صفوف - أضفها من لوحة المدير" : undefined}
        >
          <FieldError message={req(O.grade, grade)} />
          <Select
            value={grade}
            onChange={onGradeChange}
            onFocus={() => reach(O.grade)}
            disabled={activeGrades.length === 0}
            placeholder=""
            options={activeGrades.map((g) => ({ value: g.name, label: g.name }))}
          />
        </Field>

        {trackOptions.length > 0 && (
          <Field label="الشعبة" filled={!!track}>
            <FieldError message={req(O.track, track)} />
            <Select
              value={track}
              onChange={setTrack}
              onFocus={() => reach(O.track)}
              placeholder=""
              options={trackOptions.map((t) => ({ value: t, label: t }))}
            />
          </Field>
        )}

        <Field
          label="المجموعة"
          filled={!!groupId}
          hint={groupOptions.length === 0 ? "لا توجد مجموعات لهذا الصف" : undefined}
        >
          <FieldError message={req(O.group, groupId)} />
          <Select
            value={groupId}
            onChange={onGroupChange}
            onFocus={() => reach(O.group)}
            disabled={groupOptions.length === 0}
            placeholder=""
            options={groupOptions.map((g) => ({ value: g.id, label: groupLabel(g) }))}
          />
        </Field>

        <Field label="النوع" filled={!!gender}>
          <Select
            value={gender}
            onChange={setGender}
            onFocus={() => reach(O.gender)}
            placeholder=""
            options={GENDERS.map((g) => ({ value: g, label: g }))}
          />
        </Field>

        <Field label="الديانة" filled={!!religion}>
          <Select
            value={religion}
            onChange={setReligion}
            onFocus={() => reach(O.religion)}
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
            onFocus={() => reach(O.price)}
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

        <div className="sm:col-span-2 lg:col-span-3">
          <PhoneList
            label="هاتف الطالب"
            phones={studentPhones}
            setPhones={setStudentPhones}
            errors={studentPhoneErrors}
            statuses={studentWaStatuses}
            onFocus={() => reach(O.sphone)}
          />
          {hasDupOwner && (
            <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <input
                type="checkbox"
                checked={allowDup}
                onChange={(e) => setAllowDup(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              حفظ الطالب رغم أن الرقم مسجّل لطالب آخر
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
            onFocus={() => reach(O.pphone)}
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
              onFocus={() => reach(O.notes)}
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
