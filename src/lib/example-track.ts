export const EXAMPLE_TRACK_TITLE = "2:23 AM";
export const EXAMPLE_TRACK_AUDIO_FILE_NAME = "2_23_AM.mp3";
export const EXAMPLE_TRACK_COVER_FILE_NAME = "2_23_AM.jpg";
const EXAMPLE_ASSET_BASE = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}examples/`;

export async function loadExampleTrackAssets(
  fetchAsset: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<{
  audio: File;
  cover: { blob: Blob; mime: string };
}> {
  const [audioBlob, coverBlob] = await Promise.all([
    fetchAssetBlob(
      fetchAsset,
      `${EXAMPLE_ASSET_BASE}${EXAMPLE_TRACK_AUDIO_FILE_NAME}`,
      "audio/mpeg",
    ),
    fetchAssetBlob(
      fetchAsset,
      `${EXAMPLE_ASSET_BASE}${EXAMPLE_TRACK_COVER_FILE_NAME}`,
      "image/jpeg",
    ),
  ]);

  return {
    audio: new File([audioBlob], EXAMPLE_TRACK_AUDIO_FILE_NAME, {
      lastModified: 0,
      type: audioBlob.type || "audio/mpeg",
    }),
    cover: {
      blob: coverBlob,
      mime: coverBlob.type || "image/jpeg",
    },
  };
}

async function fetchAssetBlob(fetchAsset: typeof fetch, url: string, fallbackMime: string) {
  const response = await fetchAsset(url);
  if (!response.ok) {
    throw new Error(`Failed to load bundled example asset: ${response.status}`);
  }
  const blob = await response.blob();
  return blob.type ? blob : new Blob([blob], { type: fallbackMime });
}
