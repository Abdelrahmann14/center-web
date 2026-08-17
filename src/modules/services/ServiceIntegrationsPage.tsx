import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Contact, MessageCircle } from "@/components/icons";
import { api } from "@/lib/api";
import AdminWhatsappPage from "@/modules/services/AdminWhatsappPage";
import GoogleContactsPage from "@/modules/google/GoogleContactsPage";

/**
 * الخدمات - the two places this workspace reaches outside itself: WhatsApp, which
 * carries every message the system sends, and Google Contacts, which files the
 * numbers it collects.
 *
 * <p>Two tabs, one open at a time: they are two separate destinations with their
 * own controls, and mixing both on one long page buried each one's actions under
 * the other. Each tab still leads with its own health - is it working - so the
 * answer is visible on the tab before it is opened.
 */

/** Not loaded yet, or the check failed - either way there is nothing to claim. */
type Health = { tone: "ok" | "warn" | "off" | "idle"; text: string };

const IDLE: Health = { tone: "idle", text: "جارٍ التحقق…" };

const TONE: Record<Health["tone"], string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  off: "bg-slate-300",
  idle: "bg-slate-200",
};

type TabKey = "whatsapp" | "contacts";

export default function ServiceIntegrationsPage() {
  // `?tab=contacts` opens on Google Contacts - the OAuth return lands here and
  // has to show the panel the user was actually working in, not the default one.
  const [params, setParams] = useSearchParams();
  const tab: TabKey = params.get("tab") === "contacts" ? "contacts" : "whatsapp";
  const setTab = (next: TabKey) =>
    setParams(next === "contacts" ? { tab: "contacts" } : {}, { replace: true });
  const [whatsapp, setWhatsapp] = useState<Health>(IDLE);
  const [contacts, setContacts] = useState<Health>(IDLE);

  // Both are single cheap reads; fetched once so each tab can show its state
  // without being opened.
  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/services/whatsapp/status")
      .then((s) =>
        setWhatsapp(
          s.enabled ? { tone: "ok", text: "مُفعّلة" } : { tone: "off", text: "غير مُفعّلة لحسابك" }
        )
      )
      .catch(() => setWhatsapp({ tone: "warn", text: "تعذّر التحقق" }));

    api
      .get<{ enabled: boolean; configured: boolean; accounts: unknown[] }>("/google/status")
      .then((s) => {
        if (!s.configured) return setContacts({ tone: "warn", text: "غير مُعدّة على الخادم" });
        if (!s.enabled) return setContacts({ tone: "off", text: "غير مُفعّلة لحسابك" });
        const n = s.accounts?.length ?? 0;
        setContacts(
          n === 0
            ? { tone: "warn", text: "لا يوجد حساب مرتبط" }
            : { tone: "ok", text: `${n.toLocaleString("ar-EG")} حساب مرتبط` }
        );
      })
      .catch(() => setContacts({ tone: "warn", text: "تعذّر التحقق" }));
  }, []);

  return (
    <div className="w-full">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-dark">الخدمات</h1>
        <p className="mt-1 text-sm text-slate-500">
          ربط السنتر بواتساب وجهات اتصال Google، وضبط إعدادات كل خدمة.
        </p>
      </header>

      {/* Tab bar. Two equal halves on a phone: sized to their own text, the long
          "جهات اتصال Google" filled the row and pushed the short "واتساب" onto a
          line above it, so the pair read as two mismatched controls instead of
          one switch. From sm up they sit inline at their natural width. */}
      <div className="mt-5 grid grid-cols-2 gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm sm:flex sm:w-fit">
        <TabButton
          active={tab === "whatsapp"}
          onClick={() => setTab("whatsapp")}
          icon={<MessageCircle className="h-4 w-4" />}
          label="واتساب"
          health={whatsapp}
        />
        <TabButton
          active={tab === "contacts"}
          onClick={() => setTab("contacts")}
          icon={<Contact className="h-4 w-4" />}
          label="جهات اتصال Google"
          health={contacts}
        />
      </div>

      <div className="mt-6">
        {tab === "whatsapp" ? <AdminWhatsappPage /> : <GoogleContactsPage />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  health,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  health: Health;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-w-0 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition sm:px-4 ${
        active ? "bg-dark text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {/* Health dot: the tab says whether the service is working before it opens. */}
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE[health.tone]}`}
        title={health.text}
      />
    </button>
  );
}
