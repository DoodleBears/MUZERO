import { isNcmFile } from "@/lib/ncm-decode";

export type UploadImportMode = "reference" | "copy";

export function uploadImportModeForFile(
  file: Pick<File, "name">,
  sourcePath?: string,
): UploadImportMode {
  if (!sourcePath?.trim()) return "copy";
  if (isNcmFile(file.name)) return "copy";
  return "reference";
}
