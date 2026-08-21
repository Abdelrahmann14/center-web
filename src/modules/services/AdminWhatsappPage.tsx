import { useEffect, useState } from "react";
import { ChartColumn, History, MessageSquareText, ShieldAlert } from "@/components/icons";
import { api } from "@/lib/api";
import { LoaderBlock } from "@/components/PencilLoader";
import { WhatsappDashboard } from "@/modules/services/WhatsappDashboard";
import { WhatsappMessagePreviews } from "@/modules/services/WhatsappMessagePreviews";
import { WhatsappLog } from "@/modules/services/WhatsappLog";

type TabKey = "dashboard" | "messages" | "log";

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "dashboard", label: "المتابعة", icon: ChartColumn },
  { key: "messages", label: "الرسائل", icon: MessageSquareText },
  { key: "log", label: "السجل", icon: History },
];

/**
 * The WhatsApp section inside "الخدمات", gated by the super-admin enable flag.
 *
 * <p>Three tabs, in the order the questions get asked: how is it going, what do
 * the messages say, and what exactly went out. Nothing here is a setting - the
 * account, the number and the templates all belong to the platform, and a
 * teacher who could change them could break another teacher's sending. The
 * number appears on the first tab as a fact, not a screen: there is one, and it
 * either works or it does not.
 */
export default function AdminWhatsappPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabKey>("dashboard");

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/services/whatsapp/status")
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  if (enabled === null) return <LoaderBlock />;

  if (!enabled) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        لم تُفعّل الإدارة ميزة واتساب لحسابك بعد. باقي النظام يعمل بشكل طبيعي، وأزرار الإرسال عبر
        واتساب ستظهر غير متاحة حتى يتم التفعيل. تواصل مع المشرف لتفعيلها.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Dark bar, white active tab. The weight is deliberate: this is the
          section's own navigation, and on a page of white cards a white tab bar
          disappeared into them - the eye had nothing telling it these three
          switch the whole view. */}
      <div className="flex flex-wrap gap-1 rounded-2xl bg-dark p-1.5 shadow-sm">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              tab === key
                ? "bg-white text-dark shadow-sm"
                : "text-white/55 hover:bg-white/10 hover:text-white/90"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <WhatsappDashboard />}
      {tab === "messages" && <WhatsappMessagePreviews />}
      {tab === "log" && <WhatsappLog />}
    </div>
  );
}
