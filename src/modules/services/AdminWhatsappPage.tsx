import { useEffect, useState } from "react";
import { ShieldAlert } from "@/components/icons";
import { api } from "@/lib/api";
import { LoaderBlock } from "@/components/PencilLoader";
import { WhatsappService } from "@/modules/superadmin/ServicesPage";

// The WhatsApp panel inside "الخدمات", gated by the super-admin enable flag.
// When disabled it shows a notice instead of the (shared) WhatsApp UI. The
// service card above already labels the section, so no page heading here.
export default function AdminWhatsappPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/services/whatsapp/status")
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  if (enabled === null) return <LoaderBlock />;

  if (!enabled) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        لم تُفعّل الإدارة ميزة أرقام واتساب لحسابك بعد. تواصل مع المشرف لتفعيلها.
      </div>
    );
  }

  return <WhatsappService apiBase="/services/whatsapp" managed />;
}
