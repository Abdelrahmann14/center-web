import { useState } from "react";
import { Loader2, TrendingDown, TrendingUp } from "@/components/icons";
import { api, ApiError, isOfflineError } from "@/lib/api";
import { useOnline } from "@/lib/useOnline";
import { useSync } from "@/sync/SyncProvider";
import { Field, FormNotice, Modal, inputClass } from "@/components/ui";
import { useToast } from "@/components/Toast";
import type { FinanceEntry, FinanceEntryKind, Invoice } from "./types";

/**
 * The "أخرى" form: one line of money that the attendance sheet cannot know
 * about. It belongs to a single session, so the session travels with it and the
 * form never asks which lesson - the invoice it was opened from already said.
 */
export function OtherEntryModal({
  invoice,
  entry,
  onClose,
  onSaved,
}: {
  invoice: Invoice;
  /** Present when editing an existing line. */
  entry?: FinanceEntry;
  onClose: () => void;
  onSaved: (saved: FinanceEntry, isEdit: boolean) => void;
}) {
  const toast = useToast();
  const online = useOnline();
  const sync = useSync();
  const isEdit = entry !== undefined;
  const [kind, setKind] = useState<FinanceEntryKind>(entry?.kind ?? "expense");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [amount, setAmount] = useState(entry ? String(entry.amount) : "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!description.trim()) return setError("اكتب بيان البند");
    if (amount === "" || Number(amount) < 0) return setError("أدخل مبلغاً صحيحاً");

    const payload = {
      lecture_id: invoice.lecture_id,
      group_id: invoice.group_id,
      session_date: invoice.session_date,
      kind,
      description: description.trim(),
      amount: Number(amount),
    };
    // Queue the line locally and show it at once - it replays through the same
    // service the online path uses when the connection is back.
    async function saveOffline() {
      const saved = (await sync.queueFinanceEntry(
        payload,
        isEdit ? entry.id : undefined,
      )) as unknown as FinanceEntry;
      toast(isEdit ? "تم تحديث البند - بانتظار المزامنة" : "تمت إضافة البند - بانتظار المزامنة");
      onSaved(saved, isEdit);
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
        ? await api.put<FinanceEntry>(`/finance/entries/${entry.id}`, payload)
        : await api.post<FinanceEntry>("/finance/entries", payload);
      toast(isEdit ? "تم تحديث البند" : "تمت إضافة البند");
      onSaved(saved, isEdit);
    } catch (err) {
      // The request never reached the server: queue it rather than showing an
      // error that reads like a refusal.
      if (isOfflineError(err) && sync.ready) {
        try {
          await saveOffline();
          return;
        } catch {
          setError("تعذّر حفظ البند دون اتصال");
          setSaving(false);
          return;
        }
      }
      const msg = err instanceof ApiError ? err.message : "تعذّر حفظ البند";
      setError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "تعديل بند" : "بند آخر"}
      subtitle={`${invoice.lecture_name} · ${invoice.group_label}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50"
          >
            إلغاء
          </button>
          <button
            type="submit"
            form="finance-entry-form"
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-5 w-5 animate-spin" />}
            حفظ
          </button>
        </>
      }
    >
      <form id="finance-entry-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Two buttons rather than a dropdown: there are exactly two answers, and
            which one is chosen changes the sign of the money below it. */}
        <Field plain label="نوع البند">
          <div className="grid grid-cols-2 gap-2">
            <KindButton
              active={kind === "expense"}
              onClick={() => setKind("expense")}
              tone="rose"
              icon={<TrendingDown className="h-4 w-4" />}
              label="مصروف"
              hint="يُخصم من الإجمالي"
            />
            <KindButton
              active={kind === "income"}
              onClick={() => setKind("income")}
              tone="emerald"
              icon={<TrendingUp className="h-4 w-4" />}
              label="إيراد"
              hint="يُضاف للإجمالي"
            />
          </div>
        </Field>

        <Field label="البيان">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoFocus
            maxLength={200}
            className={inputClass}
          />
        </Field>

        <Field label="المبلغ">
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </Field>

        <FormNotice message={error} />
      </form>
    </Modal>
  );
}

function KindButton({
  active,
  onClick,
  tone,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  tone: "rose" | "emerald";
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  const on =
    tone === "rose"
      ? "border-rose-300 bg-rose-50 text-rose-700"
      : "border-emerald-300 bg-emerald-50 text-emerald-700";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2.5 text-right transition ${
        active ? on : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
      }`}
    >
      <span className="flex items-center gap-2 font-medium">
        {icon}
        {label}
      </span>
      <span className="mt-0.5 block text-xs opacity-70">{hint}</span>
    </button>
  );
}
