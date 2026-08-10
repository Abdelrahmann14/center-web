import { useState } from "react";
import { MessageCircle, Contact } from "lucide-react";
import AdminWhatsappPage from "@/modules/services/AdminWhatsappPage";
import GoogleContactsPage from "@/modules/google/GoogleContactsPage";

// Admin "تكامل الخدمات": a single page hosting the two external integrations as
// tabs — WhatsApp (message sending) and Contacts (Google Contacts sync).
const TABS = [
  { key: "whatsapp", label: "واتساب", icon: MessageCircle },
  { key: "contacts", label: "جهات الاتصال", icon: Contact },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function ServiceIntegrationsPage() {
  const [tab, setTab] = useState<TabKey>("whatsapp");

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mt-5 flex w-fit flex-wrap gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t.key ? "bg-dark text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* key on the active tab re-triggers a soft fade on every switch. */}
      <div key={tab} className="mt-6 animate-fade-in">
        {tab === "whatsapp" ? <AdminWhatsappPage /> : <GoogleContactsPage />}
      </div>
    </div>
  );
}
