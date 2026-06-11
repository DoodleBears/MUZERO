import { ChevronDown, Cloud, Link2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Stepper } from "@/components/ui/stepper";
import { saveSettings } from "@/db/repositories";
import type { AppSettings } from "@/db/types";
import { newId } from "@/lib/id";
import { cn } from "@/lib/utils";
import { useSyncStore } from "@/stores/sync-store";
import { upsertCloudDrive } from "@/sync/cloud-drive-repo";
import {
  buildOwnedR2Drive,
  buildTrustedR2DriveFromSetup,
  parseTrustedR2DriveSetupLink,
  saveR2CredentialsForDrive,
  type TrustedR2DriveSetupPayload,
} from "@/sync/cloud-drive-settings";
import { buildOwnerR2Connection } from "@/sync/owner-r2-connection";
import { checkR2PublicRead, checkR2WriteAccess, maskSecret } from "@/sync/r2-healthcheck";
import { connectReadOnlyManifest } from "@/sync/r2-shared-link";

/** Owner = your own R2 (read+write keys). Shared = a public link (read-only). */
type DriveMode = "owner" | "shared";

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
 * One place to add any cloud drive, as a two-step stepper modal:
 *  - "My R2" (owner): bucket + keys + public URL (+ optional in-bucket folder
 *    under Advanced) → validate read/write → name.
 *  - "Shared link" (read-only): paste a public manifest/share URL → validate →
 *    name. (V3 will share whole playlists / buckets through the same tab.)
 * Both produce a CloudDrive in the connected-drives list; step 2 names + saves.
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
  const [mode, setMode] = useState<DriveMode>("owner");
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState("");
  const [status, setStatus] = useState<ValidateStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [trustedSetup, setTrustedSetup] = useState<TrustedR2DriveSetupPayload | undefined>();
  const [syncAfterAdd, setSyncAfterAdd] = useState(false);
  const [autoSyncAfterChanges, setAutoSyncAfterChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [driveId, setDriveId] = useState(() => newId("drv"));

  // Reset the whole flow whenever the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    setMode("owner");
    setStep(0);
    setForm(EMPTY_FORM);
    setShowAdvanced(false);
    setSelectedBucket("");
    setStatus("idle");
    setMessage(null);
    setPreviewTitle("");
    setTrustedSetup(undefined);
    setSyncAfterAdd(false);
    setAutoSyncAfterChanges(false);
    setSaving(false);
    setDriveId(newId("drv"));
  }, [open]);

  function switchMode(next: DriveMode) {
    if (next === mode) return;
    setMode(next);
    setStep(0);
    setStatus("idle");
    setMessage(null);
    setSelectedBucket("");
    setPreviewTitle("");
    setTrustedSetup(undefined);
    setSyncAfterAdd(false);
    setAutoSyncAfterChanges(false);
  }

  function patch(next: Partial<DraftForm>) {
    setForm((current) => ({ ...current, ...next }));
    setStatus("idle");
    setMessage(null);
    setTrustedSetup(undefined);
  }

  function changeBucket(value: string) {
    setSelectedBucket(value);
    setStatus("idle");
    setMessage(null);
  }

  const canValidate =
    mode === "owner"
      ? !!form.endpointOrAccountId.trim() &&
        !!selectedBucket.trim() &&
        !!form.accessKeyId.trim() &&
        !!form.secretAccessKey.trim() &&
        !!form.publicUrl.trim()
      : !!form.publicUrl.trim();

  function fail(error: unknown) {
    setStatus("error");
    setMessage(error instanceof Error ? error.message : String(error));
  }

  async function validate() {
    setStatus("validating");
    setMessage(null);
    try {
      if (mode === "shared") {
        const setup = parseTrustedR2DriveSetupLink(form.publicUrl);
        if (setup) {
          setTrustedSetup(setup);
          setPreviewTitle(setup.label);
          setStatus("ok");
          return;
        }
        const read = await checkR2PublicRead(form.publicUrl);
        if (!read.ok || !read.preview) {
          setStatus("error");
          setMessage(read.hint ?? read.checks.at(-1)?.message ?? "Read check failed");
          return;
        }
        setPreviewTitle(read.preview.title);
        setStatus("ok");
        return;
      }

      const connection = buildOwnerR2Connection({
        endpointOrAccountId: form.endpointOrAccountId,
        bucket: selectedBucket,
        accessKeyId: form.accessKeyId,
        secretAccessKey: form.secretAccessKey,
        publicUrl: form.publicUrl,
        folder: form.folder,
      });
      const read = await checkR2PublicRead(connection.manifestUrl);
      if ((!read.ok || !read.preview) && !isMissingOwnerManifest(read)) {
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
      setPreviewTitle(read.preview?.title ?? selectedBucket.trim());
      setStatus("ok");
    } catch (error) {
      fail(error);
    }
  }

  async function finish() {
    setSaving(true);
    try {
      if (mode === "shared") {
        const setup = trustedSetup ?? parseTrustedR2DriveSetupLink(form.publicUrl);
        if (setup) {
          const drive = buildTrustedR2DriveFromSetup({
            id: driveId,
            setup,
            label: form.label.trim() || undefined,
          });
          const writableDrive = {
            ...drive,
            autoSyncFrequency: autoSyncAfterChanges ? "change-debounce" : "manual",
          } as const;
          await upsertCloudDrive(writableDrive);
          await saveSettings(saveR2CredentialsForDrive(settings, drive.id, setup.credentials));
          onOpenChange(false);
          if (syncAfterAdd) void useSyncStore.getState().publishDrive(drive.id);
          return;
        }
        await connectReadOnlyManifest(form.publicUrl, { label: form.label.trim() || undefined });
        onOpenChange(false);
        return;
      }
      const connection = buildOwnerR2Connection({
        endpointOrAccountId: form.endpointOrAccountId,
        bucket: selectedBucket.trim(),
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
      const writableDrive = {
        ...drive,
        autoSyncFrequency: autoSyncAfterChanges ? "change-debounce" : "manual",
      } as const;
      await upsertCloudDrive(writableDrive);
      await saveSettings(saveR2CredentialsForDrive(settings, drive.id, connection.credentials));
      onOpenChange(false);
      if (syncAfterAdd) void useSyncStore.getState().publishDrive(drive.id);
    } catch (error) {
      setSaving(false);
      fail(error);
      return;
    }
    setSaving(false);
  }

  const steps = [
    { id: "connect", label: t("settings.addDriveStepConnect") },
    { id: "name", label: t("settings.addDriveStepName") },
  ];
  const isWritableDriveFlow = mode === "owner" || Boolean(trustedSetup);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{t("settings.addDrive")}</DialogTitle>
        <DialogDescription>{t("settings.addDriveDesc")}</DialogDescription>

        {step === 0 && (
          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            <ModeTab active={mode === "owner"} onClick={() => switchMode("owner")}>
              <Cloud className="size-4" />
              {t("settings.addDriveModeOwner")}
            </ModeTab>
            <ModeTab active={mode === "shared"} onClick={() => switchMode("shared")}>
              <Link2 className="size-4" />
              {t("settings.addDriveModeShared")}
            </ModeTab>
          </div>
        )}

        <Stepper steps={steps} current={step} />

        {step === 0 && (
          <div className="flex flex-col gap-3">
            {mode === "owner" ? (
              <>
                <Field label={t("settings.cloudOwnerEndpoint")}>
                  <Input
                    value={form.endpointOrAccountId}
                    onChange={(e) => patch({ endpointOrAccountId: e.target.value })}
                    placeholder="https://<account>.r2.cloudflarestorage.com"
                  />
                </Field>
                <Field label={t("settings.cloudOwnerBucket")}>
                  <Input
                    value={selectedBucket}
                    onChange={(e) => changeBucket(e.target.value)}
                    placeholder="muzero-r2-sync-test"
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
              </>
            ) : (
              <Field label={t("settings.addDriveShareUrl")}>
                <Input
                  value={form.publicUrl}
                  onChange={(e) => patch({ publicUrl: e.target.value })}
                  placeholder="muzero://trusted-r2-drive#v1=…"
                />
                <span className="text-muted-foreground text-xs">
                  {t("settings.addDriveSharedHint")}
                </span>
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
                {mode === "owner" ? (
                  <Cloud className="size-4 text-primary" />
                ) : trustedSetup ? (
                  <ShieldCheck className="size-4 text-primary" />
                ) : (
                  <Link2 className="size-4 text-primary" />
                )}
                {mode === "owner" ? selectedBucket : previewTitle}
                {mode === "owner" && form.folder.trim() && (
                  <span className="text-muted-foreground">/ {form.folder.trim()}</span>
                )}
              </p>
              <p className="mt-1 truncate">
                {trustedSetup
                  ? t("settings.addDriveTrustedSetupSummary", {
                      bucket: trustedSetup.credentials.bucket,
                    })
                  : form.publicUrl.trim()}
              </p>
              {mode === "owner" && form.secretAccessKey && (
                <p className="mt-1">
                  {t("settings.cloudSecretStoredAs", { value: maskSecret(form.secretAccessKey) })}
                </p>
              )}
              {trustedSetup && (
                <p className="mt-1">
                  {t("settings.cloudSecretStoredAs", {
                    value: maskSecret(trustedSetup.credentials.secretAccessKey),
                  })}
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
            {isWritableDriveFlow && (
              <div className="grid gap-2 rounded-md border border-border bg-muted/20 p-3">
                <p className="font-medium text-sm">{t("settings.addDriveAfterAddTitle")}</p>
                <PostAddOption
                  id="add-drive-sync-after-add"
                  checked={syncAfterAdd}
                  label={t("settings.addDriveSyncAfterAdd")}
                  hint={t("settings.addDriveSyncAfterAddHint")}
                  onCheckedChange={setSyncAfterAdd}
                />
                <PostAddOption
                  id="add-drive-auto-sync-after-changes"
                  checked={autoSyncAfterChanges}
                  label={t("settings.addDriveAutoSyncAfterChanges")}
                  hint={t("settings.addDriveAutoSyncAfterChangesHint")}
                  onCheckedChange={setAutoSyncAfterChanges}
                />
              </div>
            )}
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

function PostAddOption({
  id,
  checked,
  label,
  hint,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  label: string;
  hint: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5">
      <Checkbox
        id={id}
        aria-label={label}
        checked={checked}
        onCheckedChange={(next) => onCheckedChange(next === true)}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        <span className="block text-muted-foreground text-xs">{hint}</span>
      </span>
    </label>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-2 rounded px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-background font-medium text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function isMissingOwnerManifest(read: Awaited<ReturnType<typeof checkR2PublicRead>>): boolean {
  return read.checks.some(
    (check) => check.id === "manifest-fetch" && /HTTP 404\b/.test(check.message),
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
