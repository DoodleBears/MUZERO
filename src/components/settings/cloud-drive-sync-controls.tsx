import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CloudDrive,
  CloudDriveAutoSyncFrequency,
  CloudDriveUploadConcurrency,
} from "@/db/types";
import {
  DEFAULT_CLOUD_DRIVE_AUTO_SYNC_FREQUENCY,
  DEFAULT_CLOUD_DRIVE_UPLOAD_CONCURRENCY,
} from "@/sync/cloud-drive-repo";

const AUTO_SYNC_OPTIONS = [
  { value: "manual", labelKey: "settings.cloudAutoSyncManual" },
  { value: "app-start", labelKey: "settings.cloudAutoSyncAppStart" },
  { value: "change-debounce", labelKey: "settings.cloudAutoSyncAfterChanges" },
  { value: "15min", labelKey: "settings.cloudAutoSyncEvery15" },
  { value: "30min", labelKey: "settings.cloudAutoSyncEvery30" },
  { value: "60min", labelKey: "settings.cloudAutoSyncEvery60" },
] as const satisfies ReadonlyArray<{
  value: CloudDriveAutoSyncFrequency;
  labelKey: string;
}>;

const UPLOAD_CONCURRENCY_OPTIONS = [
  1, 2, 3,
] as const satisfies ReadonlyArray<CloudDriveUploadConcurrency>;

interface CloudDriveSyncControlsProps {
  drive: CloudDrive;
  onAutoSyncFrequencyChange: (frequency: CloudDriveAutoSyncFrequency) => void;
  onUploadConcurrencyChange: (concurrency: CloudDriveUploadConcurrency) => void;
}

export function CloudDriveSyncControls({
  drive,
  onAutoSyncFrequencyChange,
  onUploadConcurrencyChange,
}: CloudDriveSyncControlsProps) {
  const { t } = useTranslation();
  const disabled = !drive.capabilities.write;
  const frequency = drive.autoSyncFrequency ?? DEFAULT_CLOUD_DRIVE_AUTO_SYNC_FREQUENCY;
  const uploadConcurrency = drive.uploadConcurrency ?? DEFAULT_CLOUD_DRIVE_UPLOAD_CONCURRENCY;
  const frequencyLabel = t("settings.cloudAutoSyncFrequency");
  const uploadConcurrencyLabel = t("settings.cloudUploadConcurrency");
  const frequencyLabelId = `${drive.id}-auto-sync-frequency-label`;
  const uploadConcurrencyLabelId = `${drive.id}-upload-concurrency-label`;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="grid gap-1 text-xs">
        <span id={frequencyLabelId} className="font-medium text-muted-foreground">
          {frequencyLabel}
        </span>
        <Select
          aria-label={frequencyLabel}
          disabled={disabled}
          value={frequency}
          onValueChange={(value) => onAutoSyncFrequencyChange(value as CloudDriveAutoSyncFrequency)}
        >
          <SelectTrigger aria-labelledby={frequencyLabelId} className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUTO_SYNC_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1 text-xs">
        <span id={uploadConcurrencyLabelId} className="font-medium text-muted-foreground">
          {uploadConcurrencyLabel}
        </span>
        <Select
          aria-label={uploadConcurrencyLabel}
          disabled={disabled}
          value={String(uploadConcurrency)}
          onValueChange={(value) =>
            onUploadConcurrencyChange(Number(value) as CloudDriveUploadConcurrency)
          }
        >
          <SelectTrigger aria-labelledby={uploadConcurrencyLabelId} className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UPLOAD_CONCURRENCY_OPTIONS.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {t("settings.cloudUploadConcurrencyOption", { count: value })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
