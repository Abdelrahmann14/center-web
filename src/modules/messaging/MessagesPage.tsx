import { useState } from "react";
import { History, MessageCircle, ShieldAlert } from "@/components/icons";
import { useAuth } from "@/auth/AuthContext";
import { arabicDigits } from "@/lib/datetime";
import { WhatsappInbox, useInboxUnread } from "@/modules/services/WhatsappInbox";
import { WhatsappLog } from "@/modules/services/WhatsappLog";

/**
 * «الرسائل» - a screen of its own, in the sidebar, beside the students and the
 * lessons.
 *
 * <p>It used to be two tabs buried inside الخدمات ← واتساب, which is a settings
 * area and admin-only. That was defensible while the only thing there was a
 * gallery of templates nobody edits. It stopped being defensible the moment
 * there were real conversations to answer and assistants to answer them: the
 * desk cannot reach a settings page, and a reply that waits for the owner to
 * log in is not a reply.
 *
 * <p>So the daily work - the inbox and the history - lives here, permission-
 * gated per tab, and الخدمات keeps what it was always for: the numbers, the
 * templates and the health of the account.
 */
type TabKey = "inbox" | "log";

export default function MessagesPage() {
  const { can } = useAuth();
  const maySend = can("NOTIFICATION_SEND");
  const mayReadLog = can("NOTIFICATION_LOG_VIEW");

  // Open on whichever tab this person can actually use, rather than always on
  // the inbox and bouncing somebody who only holds the log grant.
  const [tab, setTab] = useState<TabKey>(maySend ? "inbox" : "log");
  const { unread } = useInboxUnread(maySend);

  const tabs: { key: TabKey; label: string; icon: typeof MessageCircle; badge?: number }[] = [];
  if (maySend) tabs.push({ key: "inbox", label: "المحادثات", icon: MessageCircle, badge: unread });
  if (mayReadLog) tabs.push({ key: "log", label: "السجل", icon: History });

  return (
    <div className="w-full">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-dark">الرسائل</h1>
        <p className="mt-1 text-sm text-slate-500">
          محادثات واتساب مع أولياء الأمور والطلاب، وسجل كل رسالة خرجت من السنتر.
        </p>
      </header>

      {tabs.length === 0 ? (
        <div className="mt-5 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          لا تملك صلاحية على الرسائل. اطلب من صاحب الحساب صلاحية «إرسال رسائل واتساب» أو «عرض سجل
          الرسائل».
        </div>
      ) : (
        <>
          {/* One tab is not a choice - showing a switch with a single option
              would be furniture pretending to be a control. */}
          {tabs.length > 1 && (
            <div className="mt-5 flex w-fit gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-sm">
              {tabs.map(({ key, label, icon: Icon, badge }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  aria-current={tab === key ? "page" : undefined}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                    tab === key ? "bg-dark text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                  {badge != null && badge > 0 && (
                    <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      {arabicDigits(badge)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="mt-6">
            {tab === "inbox" && maySend ? <WhatsappInbox /> : <WhatsappLog />}
          </div>
        </>
      )}
    </div>
  );
}
