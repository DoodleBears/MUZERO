import { Upload, UserRound } from "lucide-react";
import { type CSSProperties, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
import { Button } from "@/components/ui/button";
import { CoverImage } from "@/components/ui/cover-image";
import type { CropRect } from "@/db/types";
import { IMAGE_ACCEPT } from "@/lib/file-drop";

interface DeviceAvatarPickerProps {
  avatarUrl: string | null;
  fallbackStyle?: CSSProperties;
  saving?: boolean;
  onSaveAvatar: (file: File, rect: CropRect) => void | Promise<void>;
}

export function DeviceAvatarPicker({
  avatarUrl,
  fallbackStyle,
  saving = false,
  onSaveAvatar,
}: DeviceAvatarPickerProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);

  function chooseFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    setCropFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function confirmCrop(rect: CropRect) {
    if (!cropFile) return;
    await onSaveAvatar(cropFile, rect);
    setCropFile(null);
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background/70 p-3">
      <CoverImage
        url={avatarUrl}
        rounded
        className="size-16 shrink-0 border border-border text-white shadow-sm"
        style={fallbackStyle}
        placeholder={<UserRound className="size-8" />}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{t("settings.deviceAvatar")}</p>
        <p className="text-muted-foreground text-xs">{t("settings.deviceAvatarHint")}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            aria-label={t("settings.deviceAvatarUpload")}
            disabled={saving}
            className="sr-only"
            onChange={(event) => chooseFile(event.currentTarget.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="size-4" />
            {t("settings.deviceAvatarUpload")}
          </Button>
        </div>
      </div>

      {cropFile && (
        <CoverCropDialog
          file={cropFile}
          saving={saving}
          onConfirm={(rect) => void confirmCrop(rect)}
          onCancel={() => setCropFile(null)}
          confirmLabel={t("settings.deviceAvatarCropApply")}
        />
      )}
    </div>
  );
}
