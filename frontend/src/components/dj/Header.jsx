import { Radio, Gamepad2, Settings } from "lucide-react";
import { useDJStore } from "@/store/djStore";

export default function Header({ s3Configured, onOpenMidi }) {
  const midi = useDJStore((s) => s.midi);
  return (
    <header data-testid="app-header"
      className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-[#0A0A0A] shrink-0">
      <div className="flex items-center gap-3">
        <img src="/dj-lab-logo.png" alt="DJ Lab"
          className="h-12 w-12 object-contain drop-shadow-[0_0_12px_rgba(209,10,10,0.55)]" />
        <div className="flex items-baseline gap-2">
          <span className="font-display font-black text-xl tracking-tight">DJ LAB</span>
          <span className="text-[10px] tracking-[0.25em] text-[#A1A1AA] uppercase font-bold">
            NU Vibe / DJsandMCMedia
          </span>
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

        <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-[#A1A1AA]">
          <span className={`w-2 h-2 rounded-full ${s3Configured ? "bg-[#FF1F1F] nu-glow-accent" : "bg-[#52525B]"}`} />
          {s3Configured ? "S3 library · live" : "Demo library"}
        </div>
        <div className="hidden md:flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-[#A1A1AA]">
          <Radio className="w-3.5 h-3.5 text-[#FF1F1F]" />
          On Air
        </div>
      </div>
    </header>
  );
}
