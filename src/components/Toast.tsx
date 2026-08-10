// Legacy toast shim. The real toast system now lives in
// `@/components/ui/toast` (react-hot-toast, RTL, project palette). This file is
// kept only so the existing `ToastProvider` / `useToast()` call sites across the
// app keep working unchanged — both now delegate to the single hot-toast engine,
// so the whole app shows one consistent toast.
import { type ReactNode } from "react";
import { toast } from "@/components/ui/toast";

type Variant = "success" | "error";
type ShowToast = (message: string, variant?: Variant, durationMs?: number) => void;

/** Fire a toast imperatively. Kept as a hook for API compatibility. */
export function useToast(): ShowToast {
  return (message, variant = "success", durationMs) =>
    toast[variant](message, durationMs ? { duration: durationMs } : undefined);
}

/**
 * Legacy provider kept for API compatibility. The toast viewport itself is now
 * mounted inside <App/> (which lives under AuthProvider) so its placement can
 * follow the signed-in role. This wrapper is therefore a pass-through.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
