import { useEffect, useState, cloneElement, Children } from "react";
import { Radio, X, Info, Send } from "lucide-react";
import { toast } from "sonner";
import { startStream, stopStream, subscribeStreamStatus, isStreaming } from "@/lib/streamService";
import { loadConfig as loadNP, saveConfig as saveNP, pushNow as pushNP, reloadConfig as reloadNP } from "@/lib/nowPlaying";

const STORAGE_KEY = "djlab.streamConfig";
const DEFAULT_CFG = {
  host: "djsandmc.media",
  port: 8005,
  mount: "/",
  user: "source",
  password: "",
  bitrate: 128,
  protocol: "shoutcast",  // AzuraCast/Liquidsoap harbor uses ICY
  stationName: "DJ Lab · NU Vibe",
  genre: "Electronic",
  description: "Live mix via DJ Lab",
};

function loadCfg() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CFG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_CFG;
}

export default function StreamConfigDialog({ open, onClose }) {
  const [cfg, setCfg] = useState(loadCfg);
  const [status, setStatus] = useState({ connected: false, errorText: null, ffmpegLines: [] });
  const [busy, setBusy] = useState(false);
  const [np, setNp] = useState(loadNP);
  const [npBusy, setNpBusy] = useState(false);

  useEffect(() => subscribeStreamStatus(setStatus), []);

  if (!open) return null;

  const saveNpAndApply = (patch) => {
    const next = { ...np, ...patch };
    setNp(next);
    saveNP(next);
    reloadNP();
  };

  const testNowPlaying = async () => {
    setNpBusy(true);
    try {
      const r = await pushNP();
      if (r?.ok) {
        toast.success("Now-Playing pushed", { description: "Listeners' players should update within a few seconds." });
      } else if (r?.status === 408) {
        toast.error("AzuraCast couldn't reach Liquidsoap", { description: "Start the live broadcast first, then push now-playing." });
      } else {
        toast.error("Now-Playing failed", { description: r?.response || "No audible deck — load a track and bring up the volume." });
      }
    } finally {
      setNpBusy(false);
    }
  };

  const save = (patch) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const handleStart = async () => {
    if (!cfg.host || !cfg.password) {
      toast.error("Host and password are required");
      return;
    }
    const mt = (cfg.mount || "").trim();
    if (!mt) {
      toast.error("Mount point can't be empty", {
        description: "Try '/' (AzuraCast default) or '/radio'.",
      });
      return;
    }
    setBusy(true);
    try {
      await startStream(cfg);
      toast.success("Connected to Icecast", { description: `${cfg.host}:${cfg.port}${cfg.mount}` });
    } catch (err) {
      console.error(err);
      toast.error("Stream failed to start", { description: "Check host / credentials and try again." });
    } finally {
      setBusy(false);
    }
  };

  const handleStop = () => {
    stopStream();
    toast.message("Stream stopped");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
         data-testid="stream-dialog">
      <div className="bg-[#0f0f0f] border-2 border-[#D10A0A]/40 rounded-lg p-5 w-[600px] max-w-[92vw] shadow-[0_0_40px_rgba(209,10,10,0.35)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-[#FF1F1F]" />
            <span className="font-display font-black text-lg tracking-tight">Live Stream · Icecast / AzuraCast</span>
          </div>
          <button onClick={onClose} data-testid="stream-close" className="text-[#A1A1AA] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {status.connected && (
          <div className="mb-3 px-3 py-2 rounded border border-[#FF1F1F]/50 bg-[#D10A0A]/10 text-[11px] tracking-[0.15em] uppercase text-[#FF1F1F] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#FF1F1F] beat-pulse" />
            ON AIR · Streaming to {cfg.host}:{cfg.port}{cfg.mount}
          </div>
        )}

        {status.errorText && (
          <div className="mb-3 px-3 py-2 rounded border border-red-500/50 bg-red-500/10 text-[11px] text-red-400">
            {status.errorText}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-[11px]">
          {/* Dummy hidden fields to confuse browser autofill — real fields below use autocomplete="off" */}
          <input type="text" autoComplete="username" style={{ display: "none" }} />
          <input type="password" autoComplete="new-password" style={{ display: "none" }} />

          <Field label="Host / server URL" required>
            <input value={cfg.host} onChange={(e) => save({ host: e.target.value })}
              data-testid="stream-host" placeholder="djsandmc.media"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
              name="dj-stream-host" />
          </Field>
          <Field label="Port" required>
            <input type="number" value={cfg.port} onChange={(e) => save({ port: +e.target.value || 8000 })}
              data-testid="stream-port" autoComplete="off" name="dj-stream-port" />
          </Field>
          <Field label="Mount point" required>
            <input value={cfg.mount} onChange={(e) => save({ mount: e.target.value })}
              data-testid="stream-mount" placeholder="/radio  (not /radio.mp3)"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
              name="dj-stream-mount" />
          </Field>
          <Field label="Source username">
            <input value={cfg.user} onChange={(e) => save({ user: e.target.value })}
              data-testid="stream-user" placeholder="djkns (your DJ streamer username)"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
              name="dj-stream-user"
              data-lpignore="true" data-1p-ignore="true" data-form-type="other" />
          </Field>
          <Field label="Source password" required>
            <input type="text" value={cfg.password}
              onChange={(e) => save({ password: e.target.value })}
              data-testid="stream-password" placeholder="enter source password"
              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
              name="dj-stream-secret"
              data-lpignore="true" data-1p-ignore="true" data-form-type="other"
              style={{ WebkitTextSecurity: cfg.password ? "disc" : "none", fontFamily: "monospace" }} />
          </Field>
          <Field label="MP3 bitrate">
            <select value={cfg.bitrate} onChange={(e) => save({ bitrate: +e.target.value })}
              data-testid="stream-bitrate">
              <option value={96}>96 kbps</option>
              <option value={128}>128 kbps</option>
              <option value={192}>192 kbps</option>
              <option value={256}>256 kbps</option>
              <option value={320}>320 kbps</option>
            </select>
          </Field>
          <Field label="Protocol">
            <select value={cfg.protocol || "shoutcast"}
              onChange={(e) => save({ protocol: e.target.value })}
              data-testid="stream-protocol">
              <option value="shoutcast">Shoutcast / ICY (AzuraCast default)</option>
              <option value="icecast">Icecast 2 (HTTP PUT)</option>
            </select>
          </Field>
          <Field label="Station name">
            <input value={cfg.stationName} onChange={(e) => save({ stationName: e.target.value })}
              data-testid="stream-station-name" autoComplete="off" name="dj-stream-station" />
          </Field>
          <Field label="Genre">
            <input value={cfg.genre} onChange={(e) => save({ genre: e.target.value })}
              data-testid="stream-genre" autoComplete="off" name="dj-stream-genre" />
          </Field>
          <div className="col-span-2">
            <Field label="Description">
              <input value={cfg.description} onChange={(e) => save({ description: e.target.value })}
                data-testid="stream-description" autoComplete="off" name="dj-stream-description" />
            </Field>
          </div>
        </div>

        {(status.connected || status.bytesSent > 0 || status.errorText) && (
          <div className="mt-3 flex items-center gap-2 text-[11px] font-mono-dj">
            <span className={`px-2 py-1 rounded border ${
              status.errorText
                ? "border-[#FF1F1F] text-[#FF1F1F]"
                : status.connected
                  ? "border-[#22c55e] text-[#22c55e]"
                  : "border-white/10 text-[#A1A1AA]"
            }`} data-testid="stream-state">
              {status.errorText ? "ERROR" : status.connected ? "ON AIR" : "IDLE"}
            </span>
            {status.bytesSent != null && (
              <span className="text-[#A1A1AA]" data-testid="stream-bytes">
                {(status.bytesSent / 1024).toFixed(1)} KB sent
              </span>
            )}
            {status.errorText && (
              <span className="text-[#FF1F1F] truncate" data-testid="stream-error" title={status.errorText}>
                {status.errorText}
              </span>
            )}
          </div>
        )}

        {status.ffmpegLines.length > 0 && (
          <details className="mt-3" open>
            <summary className="text-[10px] tracking-[0.2em] uppercase text-[#A1A1AA] cursor-pointer">
              ffmpeg log ({status.ffmpegLines.length})
            </summary>
            <pre className="mt-1 p-2 bg-black/60 border border-white/10 rounded text-[9px] text-[#A1A1AA] max-h-28 overflow-auto">
              {status.ffmpegLines.join("\n")}
            </pre>
          </details>
        )}

        {/* AzuraCast Now-Playing pusher */}
        <div className="mt-4 pt-3 border-t border-white/10" data-testid="nowplaying-section">
          <div className="flex items-center justify-between mb-2">
            <span className="font-display font-bold tracking-tight text-sm text-[#FF9500]">
              Now-Playing → AzuraCast
            </span>
            <label className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase cursor-pointer select-none">
              <input
                type="checkbox"
                checked={np.enabled}
                onChange={(e) => saveNpAndApply({ enabled: e.target.checked })}
                data-testid="nowplaying-enabled"
                className="accent-[#FF9500]"
              />
              <span className={np.enabled ? "text-[#FF9500]" : "text-[#A1A1AA]"}>
                {np.enabled ? "Auto-push ON" : "Auto-push OFF"}
              </span>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3 text-[11px]">
            <Field label="Base URL">
              <input
                type="text" value={np.base_url}
                onChange={(e) => saveNpAndApply({ base_url: e.target.value })}
                data-testid="nowplaying-base-url"
                placeholder="djsandmc.media"
              />
            </Field>
            <Field label="API Key">
              <input
                type="password" value={np.api_key}
                onChange={(e) => saveNpAndApply({ api_key: e.target.value })}
                data-testid="nowplaying-api-key"
                placeholder="xxxx:xxxx"
                autoComplete="new-password"
              />
            </Field>
            <Field label="Station ID">
              <input
                type="number" value={np.station_id}
                onChange={(e) => saveNpAndApply({ station_id: parseInt(e.target.value, 10) || 1 })}
                data-testid="nowplaying-station-id"
                min={1}
              />
            </Field>
          </div>
          <button
            type="button"
            onClick={testNowPlaying}
            disabled={npBusy || !np.api_key}
            data-testid="nowplaying-test"
            className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded border border-[#FF9500]/40 text-[10px] tracking-[0.22em] uppercase font-bold text-[#FF9500] hover:bg-[#FF9500]/10 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-3 h-3" />
            {npBusy ? "Pushing…" : "Push current track now"}
          </button>
          <div className="mt-2 text-[10px] text-[#52525B] italic">
            Auto-pushes the title + artist of the audible deck (volume × crossfader) while the live stream is active. Need a live source connected — AzuraCast can't accept metadata for an idle station.
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {isStreaming() ? (
            <button onClick={handleStop} data-testid="stream-stop"
              className="flex-1 px-4 py-2 rounded border-2 border-[#FF1F1F] bg-[#D10A0A] text-white text-[11px] font-bold tracking-[0.2em] uppercase">
              Stop Stream
            </button>
          ) : (
            <button onClick={handleStart} disabled={busy} data-testid="stream-start"
              className="flex-1 px-4 py-2 rounded border-2 border-[#D10A0A] bg-[#D10A0A]/10 text-[#FF1F1F] text-[11px] font-bold tracking-[0.2em] uppercase hover:bg-[#D10A0A] hover:text-white disabled:opacity-50">
              {busy ? "Connecting…" : "Go Live"}
            </button>
          )}
        </div>

        <div className="mt-3 flex items-start gap-2 text-[10px] text-[#52525B] italic">
          <Info className="w-3 h-3 shrink-0 mt-0.5" />
          AzuraCast / Shoutcast: enter your DJ username + password separately — we pack them as <code className="text-[#A1A1AA]">user:password</code> automatically. Credentials are stored in your browser only.
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  const child = Children.only(children);
  const mergedClassName = [
    "w-full bg-black/60 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#D10A0A]",
    child.props.className || "",
  ].join(" ").trim();
  return (
    <label className="flex flex-col gap-1">
      <span className="label-tiny">{label}{required && <span className="text-[#FF1F1F]"> *</span>}</span>
      {cloneElement(child, { className: mergedClassName })}
    </label>
  );
}
