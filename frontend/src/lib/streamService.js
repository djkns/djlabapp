/**
 * Live stream relay to an Icecast / AzuraCast server.
 *
 *  Browser (MediaRecorder WebM/Opus)
 *     │ .webm chunks every 250ms via WebSocket
 *     ▼
 *  FastAPI /api/ws/stream
 *     │ stdin
 *     ▼
 *  ffmpeg -i pipe:0 -c:a libmp3lame -b:a <bitrate> icecast://user:pass@host:port/mount
 *
 * Config is passed as URL query params on the WebSocket handshake so no
 * credentials ever sit in process args or backend DB.
 */

import { getMasterStream } from "@/lib/audioEngine";

let ws = null;
let recorder = null;
let statusListeners = new Set();
let currentStatus = { connected: false, errorText: null, ffmpegLines: [] };

const emit = (patch) => {
  currentStatus = { ...currentStatus, ...patch };
  statusListeners.forEach((fn) => fn(currentStatus));
};

export function getStreamStatus() { return currentStatus; }
export function subscribeStreamStatus(fn) {
  statusListeners.add(fn);
  fn(currentStatus);
  return () => statusListeners.delete(fn);
}

/**
 * cfg: { host, port, mount, user, password, bitrate, station_name, genre, description }
 */
export async function startStream(cfg) {
  if (ws || recorder) return; // already live

  const backend = process.env.REACT_APP_BACKEND_URL;
  const wsProto = backend?.startsWith("https") ? "wss" : "ws";
  const base = backend?.replace(/^https?:\/\//, "");
  const qs = new URLSearchParams({
    host: cfg.host,
    port: String(cfg.port || 8000),
    mount: cfg.mount || "/live.mp3",
    user: cfg.user || "source",
    password: cfg.password || "",
    bitrate: String(cfg.bitrate || 128),
    station_name: cfg.stationName || "DJ Lab · NU Vibe",
    genre: cfg.genre || "Electronic",
    description: cfg.description || "Live mix via DJ Lab",
  });

  ws = new WebSocket(`${wsProto}://${base}/api/ws/stream?${qs.toString()}`);
  ws.binaryType = "arraybuffer";

  await new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(e);
    setTimeout(() => reject(new Error("WebSocket timeout")), 8000);
  });

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "connected") {
        emit({ connected: true, errorText: null });
      } else if (msg.type === "error") {
        emit({ errorText: msg.message });
      } else if (msg.type === "ffmpeg") {
        currentStatus.ffmpegLines.push(msg.message);
        if (currentStatus.ffmpegLines.length > 40) currentStatus.ffmpegLines.shift();
        emit({});
      }
    } catch { /* ignore */ }
  };

  ws.onclose = () => { stopStream(); };

  // Start recording the master bus and send chunks as they arrive
  const stream = getMasterStream();
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  recorder = new MediaRecorder(stream, { mimeType: mime });
  recorder.ondataavailable = async (e) => {
    if (!e.data || e.data.size === 0 || !ws || ws.readyState !== 1) return;
    const buf = await e.data.arrayBuffer();
    ws.send(buf);
  };
  recorder.start(250);
}

export function stopStream() {
  try { recorder?.stop(); } catch { /* ignore */ }
  try {
    if (ws && ws.readyState === 1) ws.send("stop");
    ws?.close();
  } catch { /* ignore */ }
  recorder = null;
  ws = null;
  emit({ connected: false });
}

export function isStreaming() { return !!(ws && ws.readyState === 1 && recorder); }
