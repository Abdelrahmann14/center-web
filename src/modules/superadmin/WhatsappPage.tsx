import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import { LoaderBlock } from "@/components/PencilLoader";
import { CloudTemplates } from "./CloudTemplates";
import { MessageTypeTemplates } from "./MessageTypeTemplates";

interface CloudNum {
  id: string;
  label: string | null;
  owner_admin_id: string | null;
  phone_number_id: string;
  phone: string | null;
  display_name: string | null;
  connected: boolean;
  state: string | null;
  quality_rating: string | null;
  code_verification_status: string | null;
}

interface AdminRow {
  id: string;
  username: string;
}

const QUALITY_AR: Record<string, string> = {
  GREEN: "جودة ممتازة",
  YELLOW: "جودة متوسطة",
  RED: "جودة منخفضة",
};

/**
 * The platform's WhatsApp account, in one place: every number and every
 * template.
 *
 * <p>Read-only about numbers on purpose. A number belongs to a teacher, and the
 * steps that bring it up need to know which teacher - so provisioning lives on
 * the teacher's own page. What this screen answers is the question that has no
 * home there: across the whole platform, which numbers are live, whose are they,
 * and is any of them in trouble.
 */
export default function WhatsappPage() {
  const [nums, setNums] = useState<CloudNum[] | null>(null);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  function load() {
    return api
      .get<CloudNum[]>("/super/whatsapp/cloud/numbers")
      .then(setNums)
      .catch(() => setNums([]));
  }

  useEffect(() => {
    load();
    api
      .get<AdminRow[]>("/super/admins")
      .then((list) => setOwners(Object.fromEntries(list.map((a) => [a.id, a.username]))))
      .catch(() => setOwners({}));
  }, []);

  async function refresh() {
    setRefreshing(true);
    try {
      await api.post("/super/whatsapp/cloud/numbers/refresh", {});
      await load();
      toast.success("تم تحديث حالة الأرقام");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "تعذّر التحديث");
    } finally {
      setRefreshing(false);
    }
  }

  if (nums === null) return <LoaderBlock />;

  const live = nums.filter((n) => n.connected).length;

  return (
    <div className="space-y-4">
      {/* Full width, like every other console screen, and one surface deep: the
          numbers below are tinted lines inside their card, never cards of their
          own. */}
      <section className="overflow-hidden rounded-2xl bg-dark text-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-4 p-5 sm:p-6">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">واتساب</h1>
            <p className="mt-1 text-sm leading-6 text-white/55">
              حساب واتساب المنصة: الأرقام التي تُرسل منها رسائل المدرّسين، والقوالب المسموح
              بإرسالها.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
            <div>
              <div className="text-lg font-bold leading-tight">
                {live.toLocaleString("ar-EG")} / {nums.length.toLocaleString("ar-EG")}
              </div>
              <div className="mt-0.5 text-[11px] text-white/45">أرقام تعمل</div>
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-60"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              تحديث الحالة
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <header className="mb-4">
          <h2 className="text-base font-bold text-slate-800">الأرقام</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-400">
            إضافة رقم أو تفعيله يتم من صفحة المدرّس صاحب الرقم.
          </p>
        </header>

        {nums.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-400">
            لا توجد أرقام على الحساب بعد. أضف رقماً من صفحة المدرّس.
          </p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2 2xl:grid-cols-3 min-[1900px]:grid-cols-4">
            {nums.map((n) => (
              <div
                key={n.id}
                className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 transition ${
                  n.connected
                    ? "bg-accent/10 hover:bg-accent/20"
                    : "bg-amber-50 hover:bg-amber-100/60"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800" dir="auto">
                    {n.label || n.display_name || "رقم بدون اسم"}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    <span dir="ltr">{n.phone || n.phone_number_id}</span>
                    <span>·</span>
                    <span>
                      {n.owner_admin_id
                        ? owners[n.owner_admin_id] || "مدرّس محذوف"
                        : "رقم المنصة"}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {n.quality_rating && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500">
                      {QUALITY_AR[n.quality_rating] || n.quality_rating}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      n.connected ? "bg-green-100 text-green-700" : "bg-white text-amber-700"
                    }`}
                  >
                    {n.connected ? "يعمل" : "غير مكتمل"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <CloudTemplates />
      {/* The platform's own type-to-template mapping. Every teacher inherits it
          unless they are given one of their own on their page. */}
      <MessageTypeTemplates />
    </div>
  );
}
