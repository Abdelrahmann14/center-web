// Global toast system (web), built on react-hot-toast using the library's
// DEFAULT toast look (clean white pill, built-in success/error/loading icons and
// spring animation) — only adapted for Arabic RTL, the project font, and
// top-center placement. Warning/info reuse the generic toast with a coloured
// lucide icon since the library ships no native variant for them.
//
// Usage anywhere under a mounted <ToastViewport/>:
//   import { toast } from "@/components/ui/toast";
//   toast.success("تمت الإضافة");
//   const id = toast.loading("جارٍ الرفع"); ... toast.dismiss(id);
"use client";

import type { ReactElement } from "react";
import hotToast, { Toaster as HotToaster } from "react-hot-toast";
import { Info, TriangleAlert } from "lucide-react";

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

const opts = (o: ToastOptions) => (o.duration ? { duration: o.duration } : undefined);

export const toast = {
  success: (message: string, o: ToastOptions = {}) =>
    hotToast.success(content(message, o.title), opts(o)),
  error: (message: string, o: ToastOptions = {}) =>
    hotToast.error(content(message, o.title), opts(o)),
  loading: (message: string, o: ToastOptions = {}) =>
    hotToast.loading(content(message, o.title), opts(o)),
  warning: (message: string, o: ToastOptions = {}) =>
    hotToast(content(message, o.title), {
      icon: <TriangleAlert className="h-5 w-5 text-amber-500" />,
      ...opts(o),
    }),
  info: (message: string, o: ToastOptions = {}) =>
    hotToast(content(message, o.title), {
      icon: <Info className="h-5 w-5 text-accent" />,
      ...opts(o),
    }),
  dismiss: (id?: ToastId) => hotToast.dismiss(id),
};

/**
 * Mount once near the app root. Uses the library's default toast styling.
 * Position is role-driven by the caller: assistants/admins get "top-center",
 * the super admin keeps "top-right".
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
        duration: 4000,
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
    />
  );
}

export default ToastViewport;
