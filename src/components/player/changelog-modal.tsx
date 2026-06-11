import { ArrowUp, Plus, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { changelog, latestVersion, localize } from "@/content/changelog";
import {
  CHANGELOG_CATEGORY_ORDER,
  type ChangelogCategory,
  type ChangelogLocale,
  type ChangelogRelease,
} from "@/content/changelog/types";
import {
  getLastSeenVersion,
  recordChangelogShownAt,
  resolveChangelogAutoOpen,
  setLastSeenVersion,
} from "@/lib/changelog-seen";
import { cn } from "@/lib/utils";

/** Fire to open the full changelog history (e.g. from Settings → About). */
export const CHANGELOG_OPEN_EVENT = "muzero:changelog:open";

export function openChangelog(): void {
  window.dispatchEvent(new CustomEvent(CHANGELOG_OPEN_EVENT));
}

const CATEGORY_ICON: Record<ChangelogCategory, ComponentType<{ className?: string }>> = {
  highlight: Sparkles,
  feature: Plus,
  improvement: ArrowUp,
  fix: Wrench,
  breaking: TriangleAlert,
};

const CATEGORY_TONE: Record<ChangelogCategory, string> = {
  highlight: "text-primary",
  feature: "text-emerald-500",
  improvement: "text-sky-500",
  fix: "text-amber-500",
  breaking: "text-rose-500",
};

function toLocale(lng: string | undefined): ChangelogLocale {
  if (!lng) return "en";
  if (lng.startsWith("zh")) return "zh";
  if (lng.startsWith("ja")) return "ja";
  if (lng.startsWith("ko")) return "ko";
  return "en";
}

function byCategory(
  a: { category: ChangelogCategory },
  b: { category: ChangelogCategory },
): number {
  return (
    CHANGELOG_CATEGORY_ORDER.indexOf(a.category) - CHANGELOG_CATEGORY_ORDER.indexOf(b.category)
  );
}

/**
 * "What's New" modal. Auto-opens on mount when there are unseen releases (first
 * install seeds lastSeen and stays closed — no backlog wall), and opens the full
 * history on the CHANGELOG_OPEN_EVENT. Bundled data, no network. Shared by web
 * and desktop. See docs/prd/20260611-muzero-release-pipeline-changelog-prd §5.2.
 */
export function ChangelogModal() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<ChangelogRelease[]>([]);

  useEffect(() => {
    const decision = resolveChangelogAutoOpen(changelog, getLastSeenVersion());
    if (decision.seedLastSeen) setLastSeenVersion(decision.seedLastSeen);
    if (decision.open) {
      setShown(decision.unseen);
      setOpen(true);
      recordChangelogShownAt(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setShown(changelog);
      setOpen(true);
    };
    window.addEventListener(CHANGELOG_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CHANGELOG_OPEN_EVENT, onOpen);
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    // Acknowledge everything up to the newest release on any close path.
    if (!next) setLastSeenVersion(latestVersion);
  }, []);

  const title = useMemo(() => {
    if (shown.length === 1) return t("changelog.titleVersion", { version: shown[0].version });
    if (shown.length > 1) return t("changelog.titleCount", { count: shown.length });
    return t("changelog.title");
  }, [shown, t]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(calc(100vw-2rem),40rem)] gap-3">
        <DialogTitle className="border-border border-b pb-3">{title}</DialogTitle>
        <div className="-mr-2 max-h-[60vh] overflow-y-auto pr-2">
          {shown.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("changelog.empty")}</p>
          ) : (
            shown.map((release) => (
              <section key={release.version} className="mb-5 last:mb-0">
                <div className="mb-2 flex items-center gap-3">
                  <h3 className="min-w-0 shrink-0 truncate font-semibold text-sm">
                    {localize(release.title, locale) || `v${release.version}`}
                  </h3>
                  {/* leader line connecting the title to the version */}
                  <span aria-hidden className="h-px flex-1 bg-border" />
                  <span className="shrink-0 text-muted-foreground text-xs">
                    v{release.version} · {release.date}
                  </span>
                </div>
                {release.summary ? (
                  <p className="mb-3 text-muted-foreground text-sm">
                    {localize(release.summary, locale)}
                  </p>
                ) : null}
                <ul className="flex flex-col gap-2.5">
                  {[...release.items].sort(byCategory).map((item) => {
                    const Icon = CATEGORY_ICON[item.category];
                    return (
                      <li key={item.title.en} className="flex gap-2.5">
                        <Icon
                          className={cn("mt-0.5 size-4 shrink-0", CATEGORY_TONE[item.category])}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-muted px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground">
                              {t(`changelog.area.${item.area}`)}
                            </span>
                            <span className="font-medium text-sm">
                              {localize(item.title, locale)}
                            </span>
                            {item.platform !== "all" ? (
                              <span className="text-[11px] text-muted-foreground">
                                ({t(`changelog.platform.${item.platform}`)})
                              </span>
                            ) : null}
                          </div>
                          {item.description ? (
                            <p className="text-muted-foreground text-sm">
                              {localize(item.description, locale)}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className="flex justify-end">
          <DialogClose render={<Button>{t("changelog.gotIt")}</Button>} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
