import { useEffect, useState } from "react";
import {
  Award,
  Barcode,
  CalendarX2,
  ClipboardCheck,
  FileChartColumn,
  FileText,
  Megaphone,
  TriangleAlert,
} from "@/components/icons";
import { api } from "@/lib/api";
import { LoaderBlock } from "@/components/PencilLoader";

interface Preview {
  code: string;
  label: string;
  description: string;
  carries_file: boolean;
  ready: boolean;
  blocked_reason: string | null;
  template_name: string | null;
  /** The approved wording with the placeholders already filled; null if unready. */
  text: string | null;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  attendance: ClipboardCheck,
  absence: CalendarX2,
  exam_result: Award,
  report: FileChartColumn,
  barcode: Barcode,
  broadcast: Megaphone,
};

/** What the attachment is called in the parent's chat, per message type. */
const FILES: Record<string, string> = {
  report: "تقرير الطالب.pdf",
  barcode: "كارت الطالب.pdf",
};

/**
 * Every message the system sends, drawn the way it lands on a parent's phone.
 *
 * <p>A teacher configures none of this: they have one number, and the wording is
 * an approved template written by the platform. So the only question this screen
 * can honestly answer is "ما الذي يصل لولي الأمر باسمي؟" - and the only honest
 * way to answer it is to show the message rather than describe it.
 *
 * <p>Drawn as an INCOMING bubble - white, right-aligned, no delivery ticks -
 * because that is the parent's side of the conversation, which is the side being
 * asked about. An outgoing green bubble would be the more familiar picture and
 * the wrong one.
 *
 * <p>The values are the variable catalogue's own examples, filled server-side by
 * the same mapping the real send uses, so the preview cannot drift into showing
 * a message the system could not produce.
 */
export function WhatsappMessagePreviews() {
  const [rows, setRows] = useState<Preview[] | null>(null);

  useEffect(() => {
    api
      .get<Preview[]>("/services/whatsapp/message-previews")
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (!rows) return <LoaderBlock />;

  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
      {rows.map((p) => (
        <MessageCard key={p.code} preview={p} />
      ))}
    </div>
  );
}

function MessageCard({ preview: p }: { preview: Preview }) {
  const Icon = ICONS[p.code] ?? Megaphone;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <h3 className="font-bold text-slate-800">{p.label}</h3>
          <p className="mt-0.5 text-[11px] leading-5 text-slate-400">{p.description}</p>
        </div>
      </header>

      {/* The parent's chat, one message deep. */}
      <div className="mt-3 rounded-2xl bg-slate-100 p-3.5">
        {p.text ? (
          <div className="relative max-w-[42ch] rounded-2xl rounded-tr-sm bg-white px-3.5 py-2.5 shadow-sm">
            {p.carries_file && (
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
                <FileText className="h-5 w-5 shrink-0 text-rose-500" />
                <span className="truncate text-xs font-medium text-slate-600">
                  {FILES[p.code] ?? "ملف.pdf"}
                </span>
              </div>
            )}
            {/* Bigger and looser than the app's usual body: this is text meant to
                be read as a message, not scanned as a field. */}
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-slate-800" dir="auto">
              {p.text}
            </p>
            <div className="mt-1 text-left text-[10px] text-slate-400">٤:٣٠ م</div>
          </div>
        ) : (
          <div className="flex items-start gap-2 text-xs leading-6 font-medium text-amber-700">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {p.blocked_reason ?? "غير متاحة"}
          </div>
        )}
      </div>
    </section>
  );
}
