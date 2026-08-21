import { useCallback, useEffect, useState } from "react";
import { cachedGet, invalidate } from "@/lib/dataCache";

/**
 * How much of today's WhatsApp allowance is left.
 *
 * <p>Meta caps the whole platform - not the teacher, the platform - at a number
 * of unique recipients per rolling 24 hours: 250 until the business is verified,
 * then 2,000 and up. Every teacher's number draws on the same allowance.
 *
 * <p>Until this existed nothing in the product knew that. A teacher pressing
 * send on a hundred-student lesson found out that the allowance had run out at
 * student forty-five by scrolling the log afterwards and counting red rows. So
 * the figure now sits under every send button, faint, and the button says what
 * it will actually do rather than what was asked of it.
 */
export type Quota = {
  /** The ceiling Meta grants, platform-wide. */
  tier: number;
  tier_label: string | null;
  /** Unique recipients already spent inside the rolling window. */
  used: number;
  /** What a send may spend right now. */
  remaining: number;
  /** Held back: this side counts accepted messages, Meta counts delivered ones. */
  margin: number;
  /** Messages waiting platform-wide. */
  queued: number;
  /** Messages waiting for whatever was asked about (one lesson, or everything). */
  waiting: number;
  /**
   * When one more recipient frees up. The window rolls continuously - it does
   * NOT reset at midnight, and a screen that said so would be wrong twice a day.
   */
  next_free_at: string | null;
  /** The tier has not been read from Meta recently enough to vouch for. */
  stale: boolean;
  quality_rating: string | null;
  number_status: string | null;
  refreshed_at: string | null;
  exhausted: boolean;
};

const PATH = "/messaging/whatsapp/quota";

function pathFor(lectureId?: string, origin?: string) {
  if (!lectureId || !origin) return PATH;
  return `${PATH}?lectureId=${lectureId}&origin=${origin}`;
}

/**
 * Read the allowance, and re-read it after a send.
 *
 * <p>Through the shared cache so several buttons on one page share one request
 * instead of each firing their own — and so the number is on screen the moment
 * the page paints rather than popping in a beat later.
 */
export function useWhatsappQuota(lectureId?: string, origin?: string) {
  const path = pathFor(lectureId, origin);
  const [quota, setQuota] = useState<Quota | null>(null);

  const load = useCallback(
    (force = false) => {
      cachedGet<Quota>(path, force)
        .then(setQuota)
        // A quota that cannot be read must never block a send. The badge simply
        // does not appear, which is what it did before this existed.
        .catch(() => setQuota(null));
    },
    [path],
  );

  useEffect(() => load(), [load]);

  /** After a send: the numbers just moved, so drop every cached copy of them. */
  const refresh = useCallback(() => {
    invalidate(PATH);
    load(true);
  }, [load]);

  return { quota, refresh };
}

const AR = (n: number) => n.toLocaleString("ar-EG");

/**
 * The faint number under a send button.
 *
 * <p>Three things it deliberately does not do: it does not shout, it does not
 * block the button, and it does not round. An operator deciding whether to press
 * send needs the actual figure, and "about fifty left" is not a number anybody
 * can plan a lesson around.
 */
export function QuotaHint({
  quota,
  className = "",
}: {
  quota: Quota | null;
  className?: string;
}) {
  if (!quota) return null;

  const unlimited = quota.tier >= 2_147_483_647;
  const tone = quota.exhausted
    ? "text-rose-500"
    : quota.remaining <= 25
      ? "text-amber-600"
      : "text-slate-400";

  return (
    <span
      className={`pointer-events-none block text-[11px] leading-4 ${tone} ${className}`}
      title={quotaTitle(quota)}
    >
      {unlimited ? (
        quota.waiting > 0 ? (
          <>في الانتظار {AR(quota.waiting)}</>
        ) : null
      ) : (
        <>
          متبقّي {AR(quota.remaining)}
          {quota.waiting > 0 && <> · في الانتظار {AR(quota.waiting)}</>}
        </>
      )}
    </span>
  );
}

/**
 * The whole picture, for a hover.
 *
 * <p>Everything the short line leaves out: that the allowance is shared with
 * every other teacher, that the window rolls rather than resetting, and whether
 * the ceiling shown is one Meta confirmed or one we are assuming.
 */
function quotaTitle(q: Quota): string {
  const lines: string[] = [];
  if (q.tier >= 2_147_483_647) {
    lines.push("حصة واتساب: غير محدودة");
  } else {
    lines.push(`حصة واتساب اليومية: ${AR(q.used)} من ${AR(q.tier)} مستخدَمة`);
    lines.push(`متبقّي ${AR(q.remaining)} رقم جديد`);
  }
  lines.push("الحصة مشتركة بين كل المدرسين على المنصة");
  if (q.waiting > 0) {
    lines.push(`${AR(q.waiting)} رسالة في الانتظار — هتتبعت تلقائيًا`);
  }
  if (q.next_free_at) {
    lines.push(`أقرب تجديد: ${whenAr(q.next_free_at)}`);
  }
  if (q.number_status && q.number_status !== "CONNECTED") {
    lines.push(`حالة الرقم عند ميتا: ${q.number_status}`);
  }
  if (q.stale) {
    lines.push("لم يتم تأكيد الحد من ميتا مؤخرًا — الرقم تقديري");
  }
  return lines.join("\n");
}

/**
 * "بعد ساعتين", not a timestamp.
 *
 * <p>The allowance frees one recipient at a time as the rolling window advances,
 * so the useful question is how long to wait, not what o'clock it will be.
 */
function whenAr(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "الآن";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `بعد ${AR(minutes)} دقيقة`;
  const hours = Math.round(minutes / 60);
  return `بعد ${AR(hours)} ساعة`;
}

/**
 * What to tell the teacher after a press.
 *
 * <p>The button no longer sends, it queues — so the honest sentence is "forty
 * five are going now and fifty five when the allowance frees up", not "sent
 * 45, failed 55". The old wording was wrong in both halves.
 */
export function sendResultMessage(res: {
  sendable_now: number;
  waiting: number;
  queued: number;
  duplicate: number;
  failed: number;
  next_free_at: string | null;
}): string {
  const parts: string[] = [];
  if (res.sendable_now > 0) parts.push(`جارٍ إرسال ${AR(res.sendable_now)} رسالة`);
  if (res.waiting > 0) {
    const when = res.next_free_at ? ` (${whenAr(res.next_free_at)})` : "";
    parts.push(`و${AR(res.waiting)} في الانتظار لحد ما الحصة تتجدد${when}`);
  }
  if (res.duplicate > 0) parts.push(`تم تخطّي ${AR(res.duplicate)} اتبعتلهم قبل كده`);
  if (res.failed > 0) parts.push(`${AR(res.failed)} بدون رقم هاتف`);
  return parts.length > 0 ? parts.join(" · ") : "لا توجد رسائل للإرسال";
}
