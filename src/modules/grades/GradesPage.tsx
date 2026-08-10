import { useEffect, useState } from "react";
import { Plus, Loader2, Pencil } from "lucide-react";
import { DeleteButton } from "@/components/DeleteButton";
import { api, ApiError } from "@/lib/api";
import { cachedGet, invalidate } from "@/lib/dataCache";
import { Modal, Field, ConfirmDialog, FormNotice, Switch, Money, inputClass } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { useToast } from "@/components/Toast";
import GroupsPage from "@/modules/groups/GroupsPage";

/** Read-only master list; only the id/name are needed for center price rows. */
interface Grade {
  id: string;
  name: string;
}
interface CenterGrade {
  grade: string;
  price: number;
}
interface Center {
  id: string;
  name: string;
  is_active: boolean;
  grades: CenterGrade[];
}

export default function GradesPage() {
  const toast = useToast();
  // Centers and groups are the admin's own screens; the route already keeps
  // assistants out, so the section needs no separate permission check.
  const [grades, setGrades] = useState<Grade[]>([]);
  const [centers, setCenters] = useState<Center[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCenter, setShowCenter] = useState(false);
  const [editCenter, setEditCenter] = useState<Center | null>(null);
  const [delCenter, setDelCenter] = useState<Center | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [g, c] = await Promise.all([cachedGet<Grade[]>("/grades"), cachedGet<Center[]>("/centers")]);
      setGrades(g);
      setCenters(c);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Grades are a global master list managed by the super admin; admins read only.
  async function toggleCenter(c: Center) {
    const next = !c.is_active;
    setCenters((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: next } : x)));
    try {
      const upd = await api.put<Center>(`/centers/${c.id}`, {
        name: c.name,
        is_active: next,
        grades: c.grades,
      });
      setCenters((prev) => prev.map((x) => (x.id === c.id ? upd : x)));
      invalidate("/centers");
    } catch {
      setCenters((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: c.is_active } : x)));
      toast("تعذّر تغيير الحالة", "error");
    }
  }
  async function removeCenter(c: Center) {
    try {
      await api.del(`/centers/${c.id}`);
      setCenters((prev) => prev.filter((x) => x.id !== c.id));
      invalidate("/centers");
      toast(`تم حذف "${c.name}"`);
    } catch {
      toast("تعذّر حذف السنتر", "error");
    } finally {
      setDelCenter(null);
    }
  }

  if (loading) return <LoaderBlock />;

  return (
    <div className="space-y-10">
      {/* ── Centers ── A center is a place with a price list, not a slot in the
          week, so it is drawn as a price list. Grades are a global master list
          owned by the super admin; they only feed the price rows here. */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-dark">السناتر</h1>
            <p className="mt-1 text-sm text-slate-500">
              {centers.length.toLocaleString("ar-EG")} سنتر
            </p>
          </div>
          <button
            onClick={() => setShowCenter(true)}
            className="flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:bg-accent-hover"
          >
            <Plus className="h-5 w-5" />
            سنتر جديد
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {centers.map((c) => (
            <article
              key={c.id}
              className={`rounded-2xl border bg-white p-5 transition ${
                c.is_active
                  ? "border-slate-200 shadow-sm hover:border-accent/50 hover:shadow-md"
                  : "border-dashed border-slate-200 bg-slate-50/40"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3
                    className={`truncate text-lg font-bold ${c.is_active ? "text-dark" : "text-slate-400"}`}
                    title={c.name}
                  >
                    {c.name}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {c.grades.length === 0
                      ? "بدون أسعار"
                      : `${c.grades.length.toLocaleString("ar-EG")} صف مُسعّر`}
                    {!c.is_active && " · معطّل"}
                  </p>
                </div>
                <Switch checked={c.is_active} onChange={() => toggleCenter(c)} />
              </div>

              {/* Priced like a menu: the leader line ties each grade to its price. */}
              <div className="mt-4 space-y-2">
                {c.grades.length === 0 ? (
                  <p className="text-sm text-slate-400">حدّد الصفوف وأسعارها من التعديل.</p>
                ) : (
                  c.grades.map((cg) => (
                    <div key={cg.grade} className="flex items-baseline gap-2 text-sm">
                      <span className={`shrink-0 ${c.is_active ? "text-slate-600" : "text-slate-400"}`}>
                        {cg.grade}
                      </span>
                      <span className="min-w-4 flex-1 border-b border-dashed border-slate-200" />
                      <Money
                        value={cg.price}
                        className={`shrink-0 font-medium tabular-nums ${
                          c.is_active ? "text-dark" : "text-slate-400"
                        }`}
                      />
                    </div>
                  ))
                )}
              </div>

              <div className="mt-5 flex items-center justify-end gap-1 border-t border-slate-100 pt-3">
                <IconBtn title="تعديل" onClick={() => setEditCenter(c)}>
                  <Pencil className="h-4 w-4" />
                </IconBtn>
                <DeleteButton onClick={() => setDelCenter(c)} />
              </div>
            </article>
          ))}
          {centers.length === 0 && (
            <Empty>
              <p className="font-medium text-slate-600">لا توجد سناتر بعد</p>
              <p className="mt-1 text-sm text-slate-400">أضف سنتراً لتبدأ جدولة مجموعاته.</p>
            </Empty>
          )}
        </div>
      </section>

      {/* ── Groups ── Lives here rather than in its own nav entry: centers and
          their weekly groups are managed together. */}
      <section>
        <GroupsPage />
      </section>

      {(showCenter || editCenter) && (
        <CenterForm
          initial={editCenter ?? undefined}
          grades={grades}
          onClose={() => {
            setShowCenter(false);
            setEditCenter(null);
          }}
          onSaved={(c, isEdit) => {
            setCenters((prev) => (isEdit ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]));
            invalidate("/centers");
            setShowCenter(false);
            setEditCenter(null);
          }}
        />
      )}

      {delCenter && (
        <ConfirmDialog
          title="حذف السنتر"
          message={`هل أنت متأكد من حذف "${delCenter.name}"؟`}
          confirmLabel="حذف"
          danger
          onConfirm={() => removeCenter(delCenter)}
          onClose={() => setDelCenter(null)}
        />
      )}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-accent/10 hover:text-accent"
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      {children}
    </div>
  );
}

function CenterForm({
  initial,
  grades,
  onClose,
  onSaved,
}: {
  initial?: Center;
  grades: Grade[];
  onClose: () => void;
  onSaved: (c: Center, isEdit: boolean) => void;
}) {
  const toast = useToast();
  const isEdit = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? "");
  const initPrices = new Map((initial?.grades ?? []).map((g) => [g.grade, String(g.price)]));
  const [rows, setRows] = useState<Record<string, { on: boolean; price: string }>>(() =>
    Object.fromEntries(
      grades.map((g) => [g.name, { on: initPrices.has(g.name), price: initPrices.get(g.name) ?? "" }])
    )
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function setRow(name: string, patch: Partial<{ on: boolean; price: string }>) {
    setRows((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("أدخل اسم السنتر");
    const chosen = Object.entries(rows).filter(([, v]) => v.on);
    for (const [, v] of chosen) {
      if (v.price === "" || Number(v.price) < 0) return setError("أدخل سعراً صحيحاً لكل صف محدد");
    }
    const payload = {
      name: name.trim(),
      is_active: initial?.is_active ?? true,
      grades: chosen.map(([grade, v]) => ({ grade, price: Number(v.price) })),
    };
    setSaving(true);
    try {
      const saved = isEdit
        ? await api.put<Center>(`/centers/${initial.id}`, payload)
        : await api.post<Center>("/centers", payload);
      toast(isEdit ? "تم تحديث السنتر" : "تمت إضافة السنتر");
      onSaved(saved, isEdit);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "تعذّر حفظ السنتر";
      setError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      size="lg"
      title={isEdit ? "تعديل سنتر" : "سنتر جديد"}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50">
            إلغاء
          </button>
          <button type="submit" form="center-form" disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60">
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="center-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="اسم السنتر">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus className={inputClass} />
        </Field>
        <Field plain label="الصفوف والأسعار" hint="حدد الصفوف المتاحة بهذا السنتر وسعر كل صف">
          <div className="space-y-2">
            {grades.length === 0 && <span className="text-sm text-slate-400">أضف صفوفاً أولاً</span>}
            {grades.map((g) => {
              const row = rows[g.name] ?? { on: false, price: "" };
              return (
                <div key={g.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={row.on}
                      onChange={(e) => setRow(g.name, { on: e.target.checked })}
                      className="h-4 w-4 accent-accent"
                    />
                    {g.name}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!row.on}
                    value={row.price}
                    onChange={(e) => setRow(g.name, { price: e.target.value })}
                    placeholder="السعر"
                    className="w-28 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-slate-50 disabled:text-slate-400"
                  />
                </div>
              );
            })}
          </div>
        </Field>
        <FormNotice message={error} />
      </form>
    </Modal>
  );
}
