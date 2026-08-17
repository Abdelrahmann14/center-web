import { useEffect, useRef, useState } from "react";
import { Camera, X } from "@/components/icons";

/**
 * Barcode scanning with the device's own camera - the phone equivalent of the
 * USB scanner at the desk.
 *
 * <p>A hardware scanner is a keyboard: it "types" the code and presses Enter,
 * which is what {@code useBarcodeScanner} listens for. On a phone there is no
 * keyboard to imitate, and until now that meant the barcode on a student's card
 * was simply unusable away from the desk. This opens the back camera, watches the
 * frames, and reports the first code it reads.
 *
 * <p>Decoding uses the browser's built-in {@code BarcodeDetector}, which Chrome
 * on Android provides. No decoding library is bundled: a scanner that pulls a
 * megabyte of WASM would be dead weight for the desktop users who will never
 * open it, and dead entirely for anyone offline on a cold cache. Where the
 * browser cannot decode, the sheet says so plainly rather than showing a camera
 * that never finds anything.
 */

/** The slice of the BarcodeDetector API used here; it is not in lib.dom yet. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** The symbologies a student card can carry, plus QR for good measure. */
const FORMATS = ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "qr_code"];

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

/** Whether this browser can decode a barcode from the camera at all. */
export function cameraScanSupported(): boolean {
  return detectorCtor() !== null && !!navigator.mediaDevices?.getUserMedia;
}

export function CameraScanner({
  onScan,
  onClose,
  title = "مسح باركود الطالب",
}: {
  onScan: (code: string) => void;
  onClose: () => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Guards the frame loop against firing twice while the sheet is closing.
  const done = useRef(false);

  useEffect(() => {
    const Ctor = detectorCtor();
    if (!Ctor) {
      setError("هذا المتصفح لا يدعم قراءة الباركود بالكاميرا. استخدم Google Chrome على الهاتف.");
      return;
    }
    let stream: MediaStream | null = null;
    let frame = 0;
    let cancelled = false;
    const detector = new Ctor({ formats: FORMATS });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // The back camera is the one pointed at the card.
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        setError("تعذّر فتح الكاميرا. تأكد من السماح للموقع باستخدام الكاميرا.");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});

      const tick = async () => {
        if (cancelled || done.current) return;
        // A frame with no dimensions yet is the camera still warming up.
        if (video.readyState >= 2 && video.videoWidth > 0) {
          try {
            const hits = await detector.detect(video);
            const code = hits.map((h) => h.rawValue?.trim()).find((v) => v);
            if (code) {
              done.current = true;
              onScan(code);
              onClose();
              return;
            }
          } catch {
            // A single undecodable frame is normal - keep looking.
          }
        }
        frame = requestAnimationFrame(() => void tick());
      };
      frame = requestAnimationFrame(() => void tick());
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // onScan/onClose are called at most once, from inside the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" role="dialog" aria-label={title}>
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Camera className="h-4 w-4" />
          {title}
        </span>
        <button
          onClick={onClose}
          aria-label="إغلاق"
          className="rounded-full p-2 transition hover:bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {error ? (
          <p className="max-w-sm px-6 text-center text-sm leading-6 text-white/80">{error}</p>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            {/* A window to aim through: the card's barcode goes inside it. */}
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-32 -translate-y-1/2 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            <p className="pointer-events-none absolute bottom-10 px-6 text-center text-xs text-white/80">
              وجّه الكاميرا نحو الباركود الموجود على بطاقة الطالب
            </p>
          </>
        )}
      </div>
    </div>
  );
}
