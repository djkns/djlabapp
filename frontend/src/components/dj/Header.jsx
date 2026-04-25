import { Radio, Gamepad2, Save, FolderOpen, Square, FileAudio } from "lucide-react";
import { useDJStore } from "@/store/djStore";

export default function Header({
  s3Configured, onOpenMidi, onOpenSaveSet, onOpenSavedSets,
  recording, elapsed, onToggleRecord,
  onOpenStream, streaming,
  onOpenExport, canExport,
}) {
  const midi = useDJStore((s) => s.midi);
  const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  return (
    <header data-testid="app-header"
      className="h-20 border-b border-white/10 flex items-center justify-between px-6 bg-[#0A0A0A] shrink-0">
      <div className="flex items-center gap-3">
        <img src="/dj-lab-logo.png" alt="DJsandMCMedia"
          className="h-16 w-16 object-contain drop-shadow-[0_0_14px_rgba(209,10,10,0.6)]" />
        <span className="text-[11px] tracking-[0.28em] text-[#A1A1AA] uppercase font-bold">
          DJsandMCMedia
        </span>

        {/* REC | EXPORT | GO LIVE | Save Set | My Sets */}
        <div className="hidden md:flex items-center gap-1.5 ml-6 pl-6 border-l border-white/10">
          <button
            data-testid="record-toggle"
            onClick={onToggleRecord}
            className={`flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 rounded border transition ${
              recording
                ? "border-[#FF1F1F] bg-[#D10A0A] text-white shadow-[0_0_12px_#FF1F1F] beat-pulse"
                : "border-[#D10A0A] text-[#FF1F1F] bg-[#D10A0A]/10 hover:bg-[#D10A0A] hover:text-white"
            }`}
            title={recording ? "Stop recording" : "Record master bus"}
          >
            {recording
              ? <Square className="w-3 h-3" fill="currentColor" />
              : <span className="w-2.5 h-2.5 rounded-full bg-[#FF1F1F]" />}
            <span data-testid="record-elapsed">{recording ? fmt(elapsed) : "REC"}</span>
          </button>

          <button
            data-testid="header-export"
            onClick={onOpenExport}
            disabled={!canExport}
            className={`flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 rounded border transition ${
              canExport
                ? "border-white/15 text-[#A1A1AA] hover:text-white hover:border-white/30"
                : "border-white/10 text-[#3f3f46] cursor-not-allowed"
            }`}
            title={canExport ? "Export last recording as MP3 / WAV" : "Record a mix first to enable export"}
          >
            <FileAudio className="w-3.5 h-3.5" />
            Export
          </button>

          <button
            data-testid="header-go-live"
            onClick={onOpenStream}
            className={`flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 rounded border transition ${
              streaming
                ? "border-[#FF1F1F] text-white bg-[#D10A0A] shadow-[0_0_12px_#FF1F1F] beat-pulse"
                : "border-[#00D4FF]/50 text-[#00D4FF] bg-[#00D4FF]/5 hover:bg-[#00D4FF]/15"
            }`}
            title={streaming ? "Streaming live — click to manage" : "Go live on Icecast / AzuraCast"}
          >
            <Radio className="w-3.5 h-3.5" />
            {streaming ? "On Air" : "Go Live"}
          </button>

          <button
            data-testid="header-save-set"
            onClick={() => onOpenSaveSet?.()}
            className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 rounded border border-white/15 text-[#A1A1AA] hover:text-white hover:border-white/30 transition"
            title="Save current mix metadata"
          >
            <Save className="w-3.5 h-3.5" />
            Save Set
          </button>
          <button
            data-testid="header-saved-sets"
            onClick={() => onOpenSavedSets?.()}
            className="flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 rounded border border-white/15 text-[#A1A1AA] hover:text-white hover:border-white/30 transition"
            title="My saved sets"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            My Sets
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          data-testid="header-midi"
          onClick={onOpenMidi}
          title={midi.enabled ? `MIDI · ${midi.deviceName}` : "MIDI · click to configure"}
          className={`flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase px-3 py-1.5 rounded border transition ${
            midi.enabled
              ? "border-[#D10A0A]/50 text-[#FF1F1F] bg-[#D10A0A]/10"
              : "border-white/10 text-[#A1A1AA] hover:text-white hover:border-white/30"
          }`}
        >
          <Gamepad2 className="w-3.5 h-3.5" />
          {midi.enabled ? (midi.deviceName?.slice(0, 18) || "MIDI ON") : "MIDI"}
        </button>
      </div>
    </header>
  );
}
