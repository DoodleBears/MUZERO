import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  addMemory,
  createSession,
  createUploadedTrack,
  getTrack,
  listMemories,
} from "@/db/repositories";
import {
  TrackMemoryNotesPanel,
  type TrackMemoryNotesPanelLabels,
} from "./track-memory-notes-panel";

const labels: TrackMemoryNotesPanelLabels = {
  composer: {
    addPhoto: "Add photo",
    cancel: "Cancel",
    changePhoto: "Change photo",
    notePlaceholder: "Write a memory",
    photoInput: "Memory photo",
    removePhoto: (name) => `Remove ${name}`,
    save: "Save memory",
  },
  createMemory: "Create memory",
  waterfall: {
    deleteMemory: (memory) => `Delete ${memory.note}`,
    editMemory: (memory) => `Edit ${memory.note}`,
    empty: "No memories yet",
    photoAlt: (memory) => `Photo for ${memory.note}`,
    setCoverFromMemory: (memory) => `Use ${memory.note} as cover`,
  },
};

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-track-memory-panel-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("TrackMemoryNotesPanel", () => {
  it("renders existing memories and creates new ones from the composer", async () => {
    await addMemory({ trackId: "trk_1", note: "first train ride", createdAt: 1 }, db);

    render(
      <TrackMemoryNotesPanel
        db={db}
        formatCreatedAt={(createdAt) => `time-${createdAt}`}
        labels={labels}
        trackId="trk_1"
      />,
    );

    expect(await screen.findByText("first train ride")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create memory" }));
    expect(screen.getByPlaceholderText("Write a memory")).toHaveFocus();
    fireEvent.change(screen.getByPlaceholderText("Write a memory"), {
      target: { value: "  rainy coding loop  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    expect(await screen.findByText("rainy coding loop")).toBeInTheDocument();
    await waitFor(async () => {
      expect((await listMemories("trk_1", db)).map((memory) => memory.note)).toContain(
        "rainy coding loop",
      );
    });
  });

  it("edits and deletes memories through the waterfall callbacks", async () => {
    await addMemory({ trackId: "trk_2", note: "old note", createdAt: 1 }, db);

    render(
      <TrackMemoryNotesPanel
        db={db}
        formatCreatedAt={(createdAt) => `time-${createdAt}`}
        labels={labels}
        trackId="trk_2"
      />,
    );

    expect(await screen.findByText("old note")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Write a memory")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit old note" }));
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Write a memory")).toHaveValue("old note"),
    );
    fireEvent.change(screen.getByPlaceholderText("Write a memory"), {
      target: { value: "updated note" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    await waitFor(() => expect(screen.getByText("updated note")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("old note")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Delete updated note" }));
    await waitFor(() => expect(screen.queryByText("updated note")).not.toBeInTheDocument());
    expect(screen.getByRole("list", { name: "No memories yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create memory" })).toBeInTheDocument();
  });

  it("sets a memory photo as the track cover", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const track = await createUploadedTrack(
      {
        blob: new Blob([new Uint8Array([1])], { type: "audio/wav" }),
        durationSec: 12,
        kind: "audio",
        mime: "audio/wav",
        sessionId: session.id,
        title: "Rain Loop",
      },
      db,
    );
    const memory = await addMemory(
      {
        note: "rain window",
        photo: { blob: new Blob([new Uint8Array([7])], { type: "image/png" }), mime: "image/png" },
        trackId: track.id,
      },
      db,
    );

    render(
      <TrackMemoryNotesPanel
        db={db}
        formatCreatedAt={(createdAt) => `time-${createdAt}`}
        labels={labels}
        trackId={track.id}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Use rain window as cover" }));

    await waitFor(async () => {
      const updated = await getTrack(track.id, db);
      expect(updated?.coverBlobId).toBeTruthy();
      expect(updated?.coverBlobId).not.toBe(memory.photoBlobId);
    });
  });
});
