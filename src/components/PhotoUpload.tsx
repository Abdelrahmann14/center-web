// Super-admin profile-photo control: shows the avatar with an upload/remove
// action. Reads the file as a base64 data URL and PUTs it to the user's account.
import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { Avatar } from "@/components/Avatar";
import { CircularProgress } from "@/components/ui/circular-progress";
import { toast } from "@/components/ui/toast";

export function PhotoUpload({
  userId,
  name,
  photo,
  onChange,
}: {
  /** The login account the photo attaches to; null = no account, upload disabled. */
  userId: string | null;
  name: string;
  photo: string | null;
  onChange: (photo: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function pick(file: File | undefined) {
    if (!file || !userId) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result);
      setBusy(true);
      setError("");
      try {
        await api.put(`/super/users/${userId}/photo`, { data: dataUrl });
        onChange(dataUrl);
        toast.success("تم رفع الصورة");
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : "تعذّر رفع الصورة";
        setError(msg);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function remove() {
    if (!userId) return;
    setBusy(true);
    setError("");
    try {
      await api.del(`/super/users/${userId}/photo`);
      onChange(null);
      toast.success("تم حذف الصورة");
    } catch {
      setError("تعذّر حذف الصورة");
      toast.error("تعذّر حذف الصورة");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative inline-grid place-items-center">
        <Avatar photo={photo} name={name} size="lg" />
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-full bg-white/70 backdrop-blur-sm">
            <CircularProgress size={36} stroke={4} />
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!userId || busy}
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-200 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {photo ? "تغيير الصورة" : "رفع صورة"}
          </button>
          {photo && (
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              title="حذف الصورة"
              className="rounded-xl bg-white p-2 text-rose-600 transition hover:bg-rose-100 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* Sits on the dark identity band, so these read light, not slate. */}
        {!userId && <p className="text-xs text-white/50">لا يوجد حساب مرتبط بعد</p>}
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
