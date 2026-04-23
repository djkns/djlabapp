import { Monitor } from "lucide-react";

export default function DesktopOnlyOverlay() {
  return (
    <div data-testid="desktop-only-overlay" className="fixed inset-0 z-[100] lg:hidden bg-[#0A0A0A] flex flex-col items-center justify-center p-8 text-center">
      <img
        src="/dj-lab-logo.png"
        alt="DJ Lab"
        className="w-28 h-28 object-contain mb-6 drop-shadow-[0_0_20px_rgba(209,10,10,0.55)]"
      />
      <div className="flex items-center gap-2 mb-3 text-[#FF1F1F]">
        <Monitor className="w-4 h-4" />
        <span className="text-[10px] tracking-[0.3em] uppercase font-bold">Desktop Rig Only</span>
      </div>
      <h1 className="font-display font-black text-3xl tracking-tight mb-2">
        OPEN DJ LAB ON DESKTOP
      </h1>
      <p className="text-[#A1A1AA] text-sm max-w-xs leading-relaxed">
        Mix two decks, ride the crossfader and record your set on a screen
        <span className="text-white font-semibold"> 1024px or wider</span>.
      </p>
      <p className="mt-8 text-[10px] tracking-[0.25em] text-[#52525B] uppercase">
        Part of the NU Vibe Network
      </p>
    </div>
  );
}
