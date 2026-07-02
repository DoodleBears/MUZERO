import { beforeEach, describe, expect, it } from "vitest";
import { useNotificationStore } from "@/stores/notification-store";
import { runStreamedImportWithNotification } from "./streamed-import-notification";

beforeEach(() => useNotificationStore.getState().clear());

const queue = () => useNotificationStore.getState().queue;

describe("runStreamedImportWithNotification", () => {
  it("opens a persistent loading toast and streams live progress while running", async () => {
    let resolveRun: (msg: string) => void = () => {};
    const gate = new Promise<string>((r) => {
      resolveRun = r;
    });

    const done = runStreamedImportWithNotification({
      loadingLabel: "Importing…",
      errorLabel: "Import failed",
      run: async (onProgress) => {
        onProgress(3, 10);
        return gate; // stays pending until the test releases it
      },
    });

    // Flush microtasks so loading + first progress update are applied.
    await Promise.resolve();
    await Promise.resolve();

    const mid = queue();
    expect(mid).toHaveLength(1);
    expect(mid[0]).toMatchObject({
      type: "loading",
      message: "Importing…",
      detail: "3 / 10",
      duration: 0, // persistent until the import ends
    });
    expect(mid[0].progress).toBeCloseTo(0.3);

    resolveRun("Imported 10 into \"Focus\"");
    await done;

    const end = queue();
    expect(end).toHaveLength(1);
    expect(end[0]).toMatchObject({ type: "success", message: "Imported 10 into \"Focus\"" });
    // The bar/counter are cleared on the terminal success line.
    expect(end[0].detail).toBeUndefined();
    expect(end[0].progress).toBeUndefined();
  });

  it("reuses the same toast (no second toast) across loading → success", async () => {
    await runStreamedImportWithNotification({
      loadingLabel: "Importing…",
      errorLabel: "Import failed",
      run: async () => "done",
    });
    expect(queue()).toHaveLength(1);
    expect(queue()[0].type).toBe("success");
  });

  it("dismisses the loading toast and shows an error toast when the import throws", async () => {
    await runStreamedImportWithNotification({
      loadingLabel: "Importing…",
      errorLabel: "Import failed",
      run: async () => {
        throw new Error("boom");
      },
    });

    const items = queue();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "error", message: "Import failed" });
    // The error carries the thrown value's debug info for the copy button.
    expect(items[0].debug).toBeDefined();
  });

  it("never rejects — a failing import resolves quietly (fire-and-forget safe)", async () => {
    await expect(
      runStreamedImportWithNotification({
        loadingLabel: "Importing…",
        errorLabel: "Import failed",
        run: async () => {
          throw new Error("boom");
        },
      }),
    ).resolves.toBeUndefined();
  });
});
