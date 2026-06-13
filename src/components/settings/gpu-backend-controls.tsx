import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import {
  type GpuBackendPreference,
  type GpuPowerPreference,
  hasWebGpuSupport,
} from "@/lib/gpu-backend";

/**
 * The two GPU-acceleration selectors (backend + power preference) for the Pixi
 * Now Playing background. Shared by the Background panel (shown when a Pixi
 * renderer is active) and the Performance pane (the dedicated home), both writing
 * the same `backgroundGpuBackend` / `backgroundGpuPowerPreference` settings — one
 * source of truth, two entry points. See the performance-settings-hub PRD.
 */
export function GpuBackendControls() {
  const { t } = useTranslation();
  const settings = useSettings();
  const gpuBackend = settings.backgroundGpuBackend ?? "auto";
  const gpuPower = settings.backgroundGpuPowerPreference ?? "auto";
  const gpuBackendItems: { label: string; value: GpuBackendPreference }[] = [
    { value: "auto", label: t("background.gpuAuto") },
    { value: "webgpu", label: t("background.gpuBackendWebgpu") },
    { value: "webgl", label: t("background.gpuBackendWebgl") },
  ];
  const gpuPowerItems: { label: string; value: GpuPowerPreference }[] = [
    { value: "auto", label: t("background.gpuAuto") },
    { value: "high-performance", label: t("background.gpuPowerHigh") },
    { value: "low-power", label: t("background.gpuPowerLow") },
  ];
  const webgpuUnavailable = gpuBackend === "webgpu" && !hasWebGpuSupport();

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("background.gpuBackend")}
        </span>
        <Select
          value={gpuBackend}
          onValueChange={(value) =>
            void saveSettings({ backgroundGpuBackend: value as GpuBackendPreference })
          }
        >
          <SelectTrigger>
            <SelectValue>
              {(value) =>
                gpuBackendItems.find((item) => item.value === value)?.label ??
                t("background.gpuBackend")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {gpuBackendItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {webgpuUnavailable ? (
          <p className="text-xs text-muted-foreground">{t("background.gpuBackendUnsupported")}</p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t("background.gpuPower")}
        </span>
        <Select
          value={gpuPower}
          onValueChange={(value) =>
            void saveSettings({ backgroundGpuPowerPreference: value as GpuPowerPreference })
          }
        >
          <SelectTrigger>
            <SelectValue>
              {(value) =>
                gpuPowerItems.find((item) => item.value === value)?.label ??
                t("background.gpuPower")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {gpuPowerItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
