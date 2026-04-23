import { Monitor } from "lucide-react";

export default function DesktopOnlyOverlay() {
  return (
    <div className="fixed inset-0 z-[100] lg:hidden bg-[#0A0A0A] flex flex-col items-center justify-center p-8 text-center">
      <div className="w-20 h-20 rounded-full bg-[#C62800]/15 border border-[#C62800]/40 flex items-center justify-center mb-6 nu-glow-primary">
        <Monitor className="w-10 h-10 text-[#FF3B00]" />
      </div>
      <h1 className="font-display font-black text-3xl tracking-tight mb-2">
        DJ LAB IS A DESKTOP RIG
      </h1>
      <p className="text-[#A1A1AA] text-sm max-w-xs leading-relaxed">
        Open this on a screen <span className="text-white font-semibold">1024px or wider</span> to mix two decks, ride the crossfader and record your set.
      </p>
      <p className="mt-8 text-[10px] tracking-[0.25em] text-[#52525B] uppercase">
        Part of the NU Vibe Network
      </p>
    </div>
  );
}
