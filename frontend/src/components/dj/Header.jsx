import { Zap, Radio } from "lucide-react";

export default function Header({ s3Configured }) {
  return (
    <header
      data-testid="app-header"
      className="h-14 border-b border-white/10 flex items-center justify-between px-6 bg-[#0A0A0A] shrink-0"
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded bg-[#C62800] flex items-center justify-center nu-glow-primary">
          <Zap className="w-4 h-4 text-white" strokeWidth={3} />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-display font-black text-xl tracking-tight">DJ LAB</span>
          <span className="text-[10px] tracking-[0.25em] text-[#52525B] uppercase font-bold">
            NU Vibe / DJsandMCMedia
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-[#A1A1AA]">
          <span
            className={`w-2 h-2 rounded-full ${s3Configured ? "bg-[#FF3B00] nu-glow-accent" : "bg-[#52525B]"}`}
          />
          {s3Configured ? "S3 library · live" : "Demo library"}
        </div>
        <div className="hidden md:flex items-center gap-1.5 text-[10px] tracking-[0.2em] uppercase text-[#A1A1AA]">
          <Radio className="w-3.5 h-3.5 text-[#C62800]" />
          On Air
        </div>
      </div>
    </header>
  );
}
