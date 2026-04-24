import { useState } from "react";
import { Download, X, FileAudio } from "lucide-react";
import { toast } from "sonner";
import { blobToWavBlob, blobToMp3Blob } from "@/lib/audioEngine";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportMixDialog({ open, onClose, webmBlob, durationSec = 0 }) {
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(0);

  if (!open) return null;

  const mins = Math.floor((durationSec || 0) / 60);
  const secs = Math.floor((durationSec || 0) % 60);
  const niceDuration = `${mins}:${String(secs).padStart(2, "0")}`;
  const sizeKb = webmBlob ? Math.round(webmBlob.size / 1024) : 0;

  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const baseName = `djlab-mix-${stamp}`;

  const handleWebM = () => {
    if (!webmBlob) return;
    downloadBlob(webmBlob, `${baseName}.webm`);
    toast.success("WebM saved");
  };

  const handleWav = async () => {
    if (!webmBlob) return;
    setBusy("wav");
    try {
      const wav = await blobToWavBlob(webmBlob);
      downloadBlob(wav, `${baseName}.wav`);
      toast.success("WAV exported", { description: `${(wav.size / 1024 / 1024).toFixed(1)} MB` });
    } catch (err) {
      console.error(err);
      toast.error("WAV export failed");
    } finally { setBusy(null); }
  };

  const handleMp3 = async (bitrate) => {
    if (!webmBlob) return;
    setBusy(`mp3-${bitrate}`);
    setProgress(0);
    try {
      const mp3 = await blobToMp3Blob(webmBlob, bitrate, (p) => setProgress(p));
      downloadBlob(mp3, `${baseName}-${bitrate}kbps.mp3`);
      toast.success(`MP3 @ ${bitrate} kbps exported`, { description: `${(mp3.size / 1024 / 1024).toFixed(1)} MB` });
    } catch (err) {
      console.error(err);
      toast.error("MP3 export failed");
    } finally { setBusy(null); setProgress(0); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
         data-testid="export-dialog">
      <div className="bg-[#0f0f0f] border-2 border-[#D10A0A]/40 rounded-lg p-5 w-[440px] max-w-[92vw] shadow-[0_0_40px_rgba(209,10,10,0.35)]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileAudio className="w-5 h-5 text-[#FF1F1F]" />
            <span className="font-display font-black text-lg tracking-tight">Export Mix</span>
          </div>
          <button onClick={onClose} data-testid="export-close" className="text-[#A1A1AA] hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!webmBlob ? (
          <div className="text-sm text-[#A1A1AA] italic">No recording yet. Hit REC, play your set, then stop — export options will appear here.</div>
        ) : (
          <>
            <div className="mb-4 p-2 rounded border border-white/10 bg-black/30 flex items-center justify-between text-[11px] text-[#A1A1AA]">
              <span>Length: <span className="font-mono-dj text-white">{niceDuration}</span></span>
              <span>Source: WebM/Opus · {sizeKb} KB</span>
            </div>

            <div className="space-y-2">
              <ExportRow
                testid="export-wav"
                title="WAV"
                subtitle="Lossless · 16-bit PCM · large file"
                busy={busy === "wav"}
                disabled={!!busy && busy !== "wav"}
                onClick={handleWav}
              />
              <ExportRow
                testid="export-mp3-320"
                title="MP3 · 320 kbps"
                subtitle="Best quality for uploading / archiving"
                busy={busy === "mp3-320"}
                progress={busy === "mp3-320" ? progress : 0}
                disabled={!!busy && busy !== "mp3-320"}
                onClick={() => handleMp3(320)}
              />
              <ExportRow
                testid="export-mp3-192"
                title="MP3 · 192 kbps"
                subtitle="Balanced quality + size"
                busy={busy === "mp3-192"}
                progress={busy === "mp3-192" ? progress : 0}
                disabled={!!busy && busy !== "mp3-192"}
                onClick={() => handleMp3(192)}
              />
              <ExportRow
                testid="export-webm"
                title="WebM / Opus (original)"
                subtitle="No re-encoding · fastest"
                onClick={handleWebM}
                disabled={!!busy}
              />
            </div>

            <div className="mt-4 text-[10px] text-[#52525B] italic">
              MP3 encoding runs in your browser via lamejs. Longer mixes take longer to encode.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ExportRow({ testid, title, subtitle, busy, disabled, progress = 0, onClick }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded border transition ${
        busy
          ? "border-[#FF1F1F] bg-[#D10A0A]/20 text-white"
          : "border-white/15 hover:border-[#D10A0A] hover:bg-[#D10A0A]/5 text-white disabled:opacity-50 disabled:cursor-not-allowed"
      }`}
    >
      <div className="text-left">
        <div className="text-[12px] font-bold tracking-[0.1em] uppercase">{title}</div>
        <div className="text-[10px] text-[#A1A1AA]">{subtitle}</div>
        {busy && progress > 0 && (
          <div className="mt-1 h-[3px] w-40 bg-white/10 rounded overflow-hidden">
            <div className="h-full bg-[#FF1F1F]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <Download className={`w-4 h-4 ${busy ? "text-[#FF1F1F]" : "text-[#A1A1AA]"}`} />
    </button>
  );
}
