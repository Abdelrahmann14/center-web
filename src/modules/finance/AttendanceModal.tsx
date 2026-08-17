import { useEffect, useState } from "react";
import { Check, Loader2, Users } from "@/components/icons";
import { api, ApiError, isOfflineError } from "@/lib/api";
import { useOnline } from "@/lib/useOnline";
import { useSync } from "@/sync/SyncProvider";
import { Modal } from "@/components/ui";
import { LoaderBlock } from "@/components/PencilLoader";
import { useToast } from "@/components/Toast";
import type { AssistantAttendance, Invoice } from "./types";

/**
 * Marks which assistants ran a lesson session alongside the teacher. It belongs
 * to one session, so the session travels with it and the form never asks which
 * lesson - the invoice it opened from already said. Saving replaces the whole
 * set: whoever is ticked attended, everyone else did not.
 */
export function AttendanceModal({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const online = useOnline();
  const sync = useSync();
  const [assistants, setAssistants] = useState<AssistantAttendance[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams({
      lecture_id: invoice.lecture_id,
      date: invoice.session_date,
    });
    if (invoice.group_id) params.set("group_id", invoice.group_id);
    api
      .get<AssistantAttendance[]>(`/finance/invoices/attendance?${params}`)
      .then((rows) => {
        setAssistants(rows);
        setSelected(new Set(rows.filter((r) => r.attended).map((r) => r.id)));
      })
      .catch((err) => {
        setAssistants([]);
        toast(err instanceof ApiError ? err.message : "تعذّر تحميل المساعدين", "error");
      });
    // toast is stable in this app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.lecture_id, invoice.group_id, invoice.session_date]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function save() {
    const payload = {
      lecture_id: invoice.lecture_id,
      group_id: invoice.group_id,
      session_date: invoice.session_date,
      user_ids: [...selected],
    };

    // The whole tick-list travels, offline as online: this form edits a set, and
    // the server replaces the session's set with whatever it is sent.
    async function saveOffline() {
      await sync.queueAssistantAttendance(payload);
      toast("تم حفظ الحضور - بانتظار المزامنة");
      onSaved();
    }

    setSaving(true);
    try {
      if (!online && sync.ready) {
        await saveOffline();
        return;
      }
      await api.put("/finance/invoices/attendance", payload);
      toast("تم حفظ الحضور");
      onSaved();
    } catch (err) {
      if (isOfflineError(err) && sync.ready) {
        try {
          await saveOffline();
          return;
        } catch {
          toast("تعذّر حفظ الحضور دون اتصال", "error");
          return;
        }
      }
      toast(err instanceof ApiError ? err.message : "تعذّر حفظ الحضور", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="حضور المساعدين"
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
            type="button"
            onClick={save}
            disabled={saving || assistants === null}
            className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent-hover disabled:opacity-60"
          >
            {saving && <Loader2 className="h-5 w-5 animate-spin" />}
            حفظ
          </button>
        </>
      }
    >
      {assistants === null ? (
        <LoaderBlock />
      ) : assistants.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 py-10 text-center">
          <Users className="mx-auto mb-2 h-8 w-8 text-slate-300" />
          <p className="text-sm text-slate-500">لا يوجد مساعدون في حسابك</p>
          <p className="mt-1 text-xs text-slate-400">أضف المساعدين من صفحة المساعدين أولاً.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {assistants.map((a) => {
            const on = selected.has(a.id);
            return (
              <label
                key={a.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                  on ? "border-accent/50 bg-accent/5" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border transition ${
                    on ? "border-accent bg-accent text-white" : "border-slate-300"
                  }`}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(a.id)}
                  className="sr-only"
                />
                <span className="font-medium text-slate-700">{a.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
