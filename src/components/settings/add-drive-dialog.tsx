import { ChevronDown, Cloud, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Stepper } from "@/components/ui/stepper";
import { saveSettings } from "@/db/repositories";
import type { AppSettings } from "@/db/types";
import { newId } from "@/lib/id";
import { cn } from "@/lib/utils";
import { upsertCloudDrive } from "@/sync/cloud-drive-repo";
import { buildOwnedR2Drive, saveR2CredentialsForDrive } from "@/sync/cloud-drive-settings";
import { buildOwnerR2Connection, parseR2AccountId } from "@/sync/owner-r2-connection";
import { checkR2PublicRead, checkR2WriteAccess, maskSecret } from "@/sync/r2-healthcheck";
import { listR2Buckets } from "@/sync/r2-list-buckets";

interface DraftForm {
  endpointOrAccountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
  folder: string;
  label: string;
}

const EMPTY_FORM: DraftForm = {
  endpointOrAccountId: "",
  accessKeyId: "",
  secretAccessKey: "",
  publicUrl: "",
  folder: "",
  label: "",
};

type ValidateStatus = "idle" | "validating" | "ok" | "error";

/**
 * Add-a-cloud-drive flow as a two-step stepper modal: Step 1 collects the R2
 * connection (keys + public URL, with an optional folder under "Advanced"), runs
 * ListBuckets + read/write validation, and auto-selects the bucket; Step 2 names
 * the drive and saves it. Built to grow toward multiple drives and (later, V3)
 * adding others' shared resources.
 */
export function AddDriveDialog({
  open,
  onOpenChange,
  settings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [bucketOptions, setBucketOptions] = useState<string[]>([]);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [status, setStatus] = useState<ValidateStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [driveId, setDriveId] = useState(() => newId("drv"));

  // Reset the whole flow whenever the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setForm(EMPTY_FORM);
    setShowAdvanced(false);
    setBucketOptions([]);
    setSelectedBucket("");
    setStatus("idle");
    setMessage(null);
    setPreviewTitle("");
    setSaving(false);
    setDriveId(newId("drv"));
  }, [open]);

  function patch(next: Partial<DraftForm>) {
    setForm((current) => ({ ...current, ...next }));
    setStatus("idle");
    setMessage(null);
  }

  const canValidate =
    !!form.endpointOrAccountId.trim() &&
    !!form.accessKeyId.trim() &&
    !!form.secretAccessKey.trim() &&
    !!form.publicUrl.trim();

  async function validate() {
    setStatus("validating");
    setMessage(null);
    try {
      const accountId = parseR2AccountId(form.endpointOrAccountId);
      const buckets = await listR2Buckets({
        accountId,
        accessKeyId: form.accessKeyId.trim(),
        secretAccessKey: form.secretAccessKey.trim(),
      });
      if (buckets.length === 0) {
        setStatus("error");
        setMessage(t("settings.cloudOwnerNoBuckets"));
        return;
      }
      setBucketOptions(buckets);
      const bucket = buckets.length === 1 ? (buckets[0] ?? "") : selectedBucket;
      if (!bucket) {
        // Multiple buckets — ask the user to pick one, then validate again.
        setStatus("idle");
        return;
      }
      setSelectedBucket(bucket);

      const connection = buildOwnerR2Connection({
        endpointOrAccountId: form.endpointOrAccountId,
        bucket,
        accessKeyId: form.accessKeyId,
        secretAccessKey: form.secretAccessKey,
        publicUrl: form.publicUrl,
        folder: form.folder,
      });
      const read = await checkR2PublicRead(connection.manifestUrl);
      if (!read.ok || !read.preview) {
        setStatus("error");
        setMessage(read.hint ?? read.checks.at(-1)?.message ?? "Read check failed");
        return;
      }
      const write = await checkR2WriteAccess(connection.credentials);
      if (!write.ok) {
        setStatus("error");
        setMessage(write.hint ?? write.checks.at(-1)?.message ?? "Write check failed");
        return;
      }
      setPreviewTitle(read.preview.title);
      setStatus("ok");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function finish() {
    setSaving(true);
    try {
      const connection = buildOwnerR2Connection({
        endpointOrAccountId: form.endpointOrAccountId,
        bucket: selectedBucket,
        accessKeyId: form.accessKeyId,
        secretAccessKey: form.secretAccessKey,
        publicUrl: form.publicUrl,
        folder: form.folder,
      });
      const drive = buildOwnedR2Drive({
        id: driveId,
        label: form.label.trim() || previewTitle || selectedBucket,
        manifestUrl: connection.manifestUrl,
        publicBaseUrl: connection.publicBaseUrl,
      });
      await upsertCloudDrive(drive);
      await saveSettings(saveR2CredentialsForDrive(settings, drive.id, connection.credentials));
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const steps = [
    { id: "connect", label: t("settings.addDriveStepConnect") },
    { id: "name", label: t("settings.addDriveStepName") },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{t("settings.addDrive")}</DialogTitle>
        <DialogDescription>{t("settings.addDriveDesc")}</DialogDescription>
        <Stepper steps={steps} current={step} />

        {step === 0 && (
          <div className="flex flex-col gap-3">
            <Field label={t("settings.cloudOwnerEndpoint")}>
              <Input
                value={form.endpointOrAccountId}
                onChange={(e) => patch({ endpointOrAccountId: e.target.value })}
                placeholder="https://<account>.r2.cloudflarestorage.com"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("settings.cloudOwnerAccessKey")}>
                <Input
                  value={form.accessKeyId}
                  onChange={(e) => patch({ accessKeyId: e.target.value })}
                />
              </Field>
              <Field label={t("settings.cloudOwnerSecretKey")}>
                <Input
                  type="password"
                  value={form.secretAccessKey}
                  onChange={(e) => patch({ secretAccessKey: e.target.value })}
                />
              </Field>
            </div>
            <Field label={t("settings.cloudOwnerPublicUrl")}>
              <Input
                value={form.publicUrl}
                onChange={(e) => patch({ publicUrl: e.target.value })}
                placeholder="https://pub-xxxx.r2.dev"
              />
            </Field>

            <div className="rounded-md border border-border">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-muted-foreground text-sm"
              >
                <span>{t("settings.addDriveAdvanced")}</span>
                <ChevronDown
                  className={cn("size-4 transition-transform", showAdvanced && "rotate-180")}
                />
              </button>
              {showAdvanced && (
                <div className="border-border border-t px-3 py-3">
                  <Field label={t("settings.addDriveFolder")}>
                    <Input
                      value={form.folder}
                      onChange={(e) => patch({ folder: e.target.value })}
                      placeholder="music/2024"
                    />
                  </Field>
                  <p className="mt-1.5 text-muted-foreground text-xs">
                    {t("settings.addDriveFolderHint")}
                  </p>
                </div>
              )}
            </div>

            {bucketOptions.length > 1 && (
              <Field label={t("settings.cloudOwnerBucket")}>
                <Select
                  value={selectedBucket}
                  onValueChange={(value) => setSelectedBucket(value ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("settings.cloudOwnerSelectBucket")} />
                  </SelectTrigger>
                  <SelectContent>
                    {bucketOptions.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {message && (
              <p
                className={
                  status === "error" ? "text-destructive text-xs" : "text-muted-foreground text-xs"
                }
              >
                {message}
              </p>
            )}
            {status === "ok" && (
              <p className="text-primary text-xs">{t("settings.addDriveValidated")}</p>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!canValidate || status === "validating"}
                onClick={() => void validate()}
              >
                <ShieldCheck />
                {status === "validating"
                  ? t("settings.cloudOwnerChecking")
                  : t("settings.cloudOwnerValidate")}
              </Button>
              <Button size="sm" disabled={status !== "ok"} onClick={() => setStep(1)}>
                {t("settings.addDriveNext")}
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-border bg-muted/25 p-3 text-muted-foreground text-xs">
              <p className="flex items-center gap-2 text-foreground text-sm">
                <Cloud className="size-4 text-primary" />
                {selectedBucket}
                {form.folder.trim() && (
                  <span className="text-muted-foreground">/ {form.folder.trim()}</span>
                )}
              </p>
              <p className="mt-1 truncate">{form.publicUrl.trim()}</p>
              {form.secretAccessKey && (
                <p className="mt-1">
                  {t("settings.cloudSecretStoredAs", { value: maskSecret(form.secretAccessKey) })}
                </p>
              )}
            </div>
            <Field label={t("settings.cloudDriveLabel")}>
              <Input
                value={form.label}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder={
                  previewTitle || selectedBucket || t("settings.cloudDriveLabelPlaceholder")
                }
              />
            </Field>
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
                {t("settings.addDriveBack")}
              </Button>
              <Button size="sm" disabled={saving} onClick={() => void finish()}>
                {t("settings.addDriveFinish")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: control supplied via children
    <label className="flex flex-col gap-1.5">
      <span className="font-medium text-muted-foreground text-xs">{label}</span>
      {children}
    </label>
  );
}
