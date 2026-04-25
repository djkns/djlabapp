// Read ID3 / MP4 / FLAC / WAV (RIFF INFO) tags from a File/Blob using jsmediatags.
// Returns { title, artist, album, year, bpm, picture } — all optional.
import jsmediatags from "jsmediatags/dist/jsmediatags.min.js";

const bytesToDataUrl = (data, format) => {
  if (!data || !Array.isArray(data) && !(data instanceof Uint8Array)) return null;
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = window.btoa(binary);
  return `data:${format || "image/jpeg"};base64,${b64}`;
};

export function readTags(file) {
  return new Promise((resolve) => {
    try {
      jsmediatags.read(file, {
        onSuccess: ({ tags }) => {
          const picture = tags?.picture
            ? bytesToDataUrl(tags.picture.data, tags.picture.format)
            : null;
          const bpmRaw = tags?.TBPM?.data ?? tags?.bpm ?? tags?.BPM;
          const bpm = bpmRaw ? parseFloat(String(bpmRaw).trim()) : null;
          resolve({
            title: tags?.title || null,
            artist: tags?.artist || null,
            album: tags?.album || null,
            year: tags?.year || null,
            genre: tags?.genre || null,
            bpm: Number.isFinite(bpm) ? bpm : null,
            picture,
          });
        },
        onError: () => resolve({}),
      });
    } catch {
      resolve({});
    }
  });
}

/**
 * Read tags from a streaming URL by fetching the FIRST 256KB only and feeding
 * that blob to jsmediatags. ID3v2 tags live in the first ~10-100KB of an MP3
 * (including any embedded album art), so 256KB is a safe ceiling — keeps the
 * cost low for our 1,725-track S3 library.
 */
export async function readTagsFromUrl(url, { rangeBytes = 262144 } = {}) {
  try {
    // Try a Range request first — most S3-backed proxies honor this and skip
    // downloading the full track.
    let resp = await fetch(url, { headers: { Range: `bytes=0-${rangeBytes - 1}` } });
    if (!resp.ok) {
      // Fallback: server doesn't support Range, just fetch the whole thing.
      resp = await fetch(url);
      if (!resp.ok) return {};
    }
    const blob = await resp.blob();
    return await readTags(blob);
  } catch {
    return {};
  }
}
