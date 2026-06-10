import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/**
 * Right-click affordance to remove a pinned cover — shared by the set cover and
 * the derived artist/album entity covers. Choosing "remove" reverts to the
 * default (the first member track that has a cover). Renders children bare when
 * there's nothing to remove, so a right-click never opens an empty menu.
 */
export function CoverContextMenu({
  hasCover,
  onRemove,
  children,
}: {
  hasCover: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (!hasCover) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger className="shrink-0">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRemove}>
          <RotateCcw /> {t("gallery.removeCover")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
