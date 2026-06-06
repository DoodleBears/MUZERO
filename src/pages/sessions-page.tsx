import { Disc3, FileVideo, Plus, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { createSession } from "@/db/repositories";
import { useSessions } from "@/hooks/use-app-data";
import { cn, formatDuration } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

/** Pick or start a set — an AI DJ set, or an upload/video set of your own files. */
export function SessionsPage({ onStarted }: { onStarted: () => void }) {
  const { t } = useTranslation();
  const seedIdeas = t("sessions.seedIdeas", { returnObjects: true }) as string[];
  const sessions = useSessions();
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);
  const setActiveSession = usePlayerStore((s) => s.setActiveSession);
  const addUploads = usePlayerStore((s) => s.addUploads);
  const isUploading = usePlayerStore((s) => s.isUploading);
  const [seed, setSeed] = useState("");
  const uploadRef = useRef<HTMLInputElement | null>(null);

  async function startDjSet(seedPrompt: string) {
    const trimmed = seedPrompt.trim();
    if (!trimmed) return;
    const session = await createSession({ seedPrompt: trimmed });
    await setActiveSession(session.id);
    setSeed("");
    onStarted();
  }

  async function newUploadSet(files: File[]) {
    if (files.length === 0) return;
    const session = await createSession({
      name: t("sessions.uploadSet"),
      seedPrompt: "",
      config: { autoExtend: false },
      displayMode: "video",
    });
    await setActiveSession(session.id);
    await addUploads(files);
    onStarted();
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold">{t("sessions.startDjTitle")}</h2>
        <Textarea
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder={t("sessions.vibePlaceholder")}
          className="mb-3"
        />
        <div className="mb-3 flex flex-wrap gap-1.5">
          {seedIdeas.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setSeed(idea)}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              {idea}
            </button>
          ))}
        </div>
        <Button className="w-full" disabled={!seed.trim()} onClick={() => void startDjSet(seed)}>
          <Plus /> {t("sessions.startDjSet")}
        </Button>
      </Card>

      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold">{t("sessions.uploadTitle")}</h2>
        <p className="text-xs text-muted-foreground">{t("sessions.uploadDesc")}</p>
        <Button
          variant="secondary"
          className="w-full"
          disabled={isUploading}
          onClick={() => uploadRef.current?.click()}
        >
          <Upload /> {isUploading ? t("sessions.importing") : t("sessions.uploadCta")}
        </Button>
        <input
          ref={uploadRef}
          type="file"
          accept="audio/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            // Snapshot the files synchronously: clearing the input below empties
            // the same FileList object, and newUploadSet reads it after an await.
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            if (files.length) void newUploadSet(files);
          }}
        />
      </Card>

      {sessions.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("sessions.yourSets")}
          </h3>
          {sessions.map((session) => {
            const isDj = session.config.autoExtend;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => void setActiveSession(session.id).then(onStarted)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:bg-accent",
                  session.id === activeSessionId && "border-primary/50 bg-accent",
                )}
              >
                {isDj ? (
                  <Disc3
                    className={cn(
                      "size-5 shrink-0",
                      session.id === activeSessionId && "text-primary",
                    )}
                  />
                ) : (
                  <FileVideo
                    className={cn(
                      "size-5 shrink-0",
                      session.id === activeSessionId && "text-primary",
                    )}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{session.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {isDj ? session.seedPrompt : t("sessions.uploadSet")} ·{" "}
                    {t("nowPlaying.modeTitle", { mode: t(`displayMode.${session.displayMode}`) })}
                  </div>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {session.trackIds.length}
                  {isDj &&
                    ` · ~${formatDuration(session.trackIds.length * session.config.targetDurationSec)}`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
