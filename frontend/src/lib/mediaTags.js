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
    } catch (e) {
      resolve({});
    }
  });
}
