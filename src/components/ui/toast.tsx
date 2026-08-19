// Global toast system (web), built on react-hot-toast using the library's
// DEFAULT toast look (clean white pill, built-in success/error/loading icons and
// spring animation) - only adapted for Arabic RTL, the project font, and
// top-center placement. Warning/info reuse the generic toast with a coloured
// lucide icon since the library ships no native variant for them.
//
// Usage anywhere under a mounted <ToastViewport/>:
//   import { toast } from "@/components/ui/toast";
//   toast.success("تمت الإضافة");
//   const id = toast.loading("جارٍ الرفع"); ... toast.dismiss(id);
"use client";

import { useRef, useState, type ReactElement } from "react";
import hotToast, { Toaster as HotToaster, ToastBar, type Toast } from "react-hot-toast";
import { Info, TriangleAlert } from "@/components/icons";

type ToastId = string;

export interface ToastOptions {
  /** Bold line above the message. */
  title?: string;
  /** Auto-dismiss in ms. Omit to use the library default. */
  duration?: number;
}

// A title renders as a bold first line above the message; otherwise the message
// is passed as a plain string so the default pill sizes to a single line.
function content(message: string, title?: string): string | ReactElement {
  if (!title) return message;
  return (
    <span style={{ display: "grid", gap: 2 }}>
      <span style={{ fontWeight: 600 }}>{title}</span>
      <span>{message}</span>
    </span>
  );
}

// One accent colour per variant. It tints the icon only, so the kind of toast
// reads from the glyph without a coloured stripe on the pill.
const ACCENT = {
  success: "#22c55e",
  error: "#f43f5e",
  warning: "#f59e0b",
  info: "#38bdf8",
} as const;

// Per-toast options: just the caller's duration. The pill keeps its uniform 1px
// border on every side - no coloured edge stripe.
function variantOpts(_kind: keyof typeof ACCENT, o: ToastOptions) {
  return o.duration ? { duration: o.duration } : {};
}

// Brighter than the library defaults so the built-in check/cross stays legible
// against the dark pill; the secondary (glyph interior) sits on that dark ground.
const iconTheme = (kind: "success" | "error") => ({
  primary: ACCENT[kind],
  secondary: "#0f172a",
});

export const toast = {
  success: (message: string, o: ToastOptions = {}) =>
    hotToast.success(content(message, o.title), {
      ...variantOpts("success", o),
      iconTheme: iconTheme("success"),
    }),
  error: (message: string, o: ToastOptions = {}) =>
    hotToast.error(content(message, o.title), {
      ...variantOpts("error", o),
      iconTheme: iconTheme("error"),
    }),
  loading: (message: string, o: ToastOptions = {}) =>
    hotToast.loading(content(message, o.title), o.duration ? { duration: o.duration } : undefined),
  warning: (message: string, o: ToastOptions = {}) =>
    hotToast(content(message, o.title), {
      icon: <TriangleAlert className="h-5 w-5 text-amber-500" />,
      ...variantOpts("warning", o),
    }),
  info: (message: string, o: ToastOptions = {}) =>
    hotToast(content(message, o.title), {
      icon: <Info className="h-5 w-5 text-sky-400" />,
      ...variantOpts("info", o),
    }),
  dismiss: (id?: ToastId) => hotToast.dismiss(id),
};

/**
 * One toast, made swipeable: drag it left or right and, past a small threshold,
 * it dismisses. Below the threshold it springs back. The library's own
 * {@link ToastBar} is kept inside, so the pill, icons and enter/exit animation
 * are unchanged - only a drag gesture is layered on top.
 */
function SwipeableToast({ t }: { t: Toast }) {
  const [dx, setDx] = useState(0);
  const startX = useRef<number | null>(null);
  const dragging = startX.current !== null;

  function end(dismiss: boolean) {
    if (dismiss) hotToast.dismiss(t.id);
    else setDx(0);
    startX.current = null;
  }

  return (
    <div
      onPointerDown={(e) => {
        startX.current = e.clientX;
        setDx(0);
      }}
      onPointerMove={(e) => {
        if (startX.current !== null) setDx(e.clientX - startX.current);
      }}
      onPointerUp={() => end(Math.abs(dx) > 80)}
      onPointerCancel={() => end(false)}
      style={{
        transform: dx ? `translateX(${dx}px)` : undefined,
        opacity: dx ? Math.max(0.2, 1 - Math.abs(dx) / 220) : 1,
        transition: dragging ? "none" : "transform 0.2s ease, opacity 0.2s ease",
        touchAction: "pan-y",
        cursor: "grab",
      }}
    >
      <ToastBar toast={t} />
    </div>
  );
}

/**
 * Mount once near the app root. Uses the library's default toast styling.
 * Position is role-driven by the caller: assistants/admins get "top-center",
 * the super admin keeps "top-right". Each toast can be swiped away left/right.
 */
export function ToastViewport({
  position = "top-center",
}: {
  position?: "top-center" | "top-right";
}) {
  return (
    <HotToaster
      position={position}
      gutter={8}
      containerStyle={{ direction: "ltr" }}
      toastOptions={{
        // Every toast auto-dismisses after 5s unless the caller overrides it.
        duration: 5000,
        style: {
          direction: "rtl",
          fontFamily: "inherit",
          textAlign: "right",
          // Darker surface than the white page so toasts stand out clearly.
          background: "#1e293b",
          color: "#f1f5f9",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 10px 25px rgba(15,23,42,0.35)",
        },
      }}
    >
      {(t) => <SwipeableToast t={t} />}
    </HotToaster>
  );
}

export default ToastViewport;
