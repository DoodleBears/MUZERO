import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SETTINGS_NAV } from "./settings-nav";

/**
 * Left rail for the two-column Settings page: sections (group headers) → item
 * buttons. The active item is owned by `nav-store`; this component is purely
 * presentational. Under `md` it collapses to a horizontal, scrollable row above
 * the detail pane (section headers hidden).
 */
export function SettingsSidebar({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("settings.navSecAppearance")}
      className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 md:mx-0 md:w-52 md:flex-col md:overflow-visible md:px-0"
    >
      {SETTINGS_NAV.map((section) => (
        <div key={section.labelKey} className="flex shrink-0 gap-1 md:flex-col">
          <p className="hidden px-2 pt-3 pb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide md:block">
            {t(section.labelKey)}
          </p>
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                active === item.id
                  ? "bg-primary/15 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
