import { Crop as CropIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { CropRect } from "@/db/types";
import { useObjectUrl } from "@/hooks/use-media";

/**
 * Square crop picker (react-easy-crop). Returns the chosen region in the
 * original image's pixels — the caller stores it non-destructively, so the full
 * image is kept and the crop can be toggled off later.
 */
export function CoverCropDialog({
  file,
  saving = false,
  onConfirm,
  onCancel,
  confirmLabel,
  secondary,
}: {
  file: File;
  saving?: boolean;
  onConfirm: (rect: CropRect) => void;
  onCancel: () => void;
  /** Override the primary button label (defaults to "Done"). */
  confirmLabel?: string;
  /** Optional second confirm action (a different target), rendered before the primary. */
  secondary?: { label: string; onConfirm: (rect: CropRect) => void };
}) {
  const { t } = useTranslation();
  const url = useObjectUrl(file);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const areaRef = useRef<Area | null>(null);

  function currentRect(): CropRect | null {
    const a = areaRef.current;
    if (!a) return null;
    return {
      x: Math.round(a.x),
      y: Math.round(a.y),
      width: Math.round(a.width),
      height: Math.round(a.height),
    };
  }

  function confirm() {
    const rect = currentRect();
    if (rect) onConfirm(rect);
  }

  function confirmSecondary() {
    const rect = currentRect();
    if (rect && secondary) secondary.onConfirm(rect);
  }

  // Esc cancels; Enter confirms the PRIMARY action (unless a button is focused,
  // which handles its own Enter natively). Depends on onConfirm so the latest
  // target is used.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
        return;
      }
      if (e.key !== "Enter" || e.repeat || e.isComposing) return;
      const el = e.target;
      if (el instanceof HTMLElement && el.closest("button")) return;
      const a = areaRef.current;
      if (!a) return;
      e.preventDefault();
      onConfirm({
        x: Math.round(a.x),
        y: Math.round(a.y),
        width: Math.round(a.width),
        height: Math.round(a.height),
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onConfirm]);

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4 duration-150 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={t("crop.title")}
    >
      <button
        type="button"
        aria-label={t("drop.cancel")}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-background/70 backdrop-blur-sm"
      />
      <div className="relative flex w-full max-w-md flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <h2 className="text-base font-semibold">{t("crop.title")}</h2>
        <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
          {url && (
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              aspect={1}
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_, areaPixels) => {
                areaRef.current = areaPixels;
              }}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <CropIcon className="size-4 shrink-0 text-muted-foreground" />
          <Slider
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onValueChange={setZoom}
            aria-label={t("crop.zoom")}
            className="flex-1"
          />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t("drop.cancel")}
          </Button>
          {secondary && (
            <Button variant="outline" onClick={confirmSecondary} loading={saving}>
              {secondary.label}
            </Button>
          )}
          <Button onClick={confirm} loading={saving}>
            <CropIcon className="size-4" />
            {confirmLabel ?? t("crop.apply")}
          </Button>
        </div>
      </div>
    </div>
  );
}
