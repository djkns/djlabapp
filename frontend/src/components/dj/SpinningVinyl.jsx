import { Disc3 } from "lucide-react";

export default function SpinningVinyl({ spinning, label = "NU", size = 160 }) {
  return (
    <div
      data-testid="spinning-vinyl"
      className="relative rounded-full border-[6px] border-[#0a0a0a] shadow-2xl flex items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        background: "#050505",
      }}
    >
      <div
        className={`absolute inset-0 rounded-full vinyl-grooves ${spinning ? "vinyl-spin" : ""}`}
      />
      {/* Red highlight reflection */}
      <div className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, rgba(255,59,0,0.08) 0%, transparent 40%)",
        }}
      />
      {/* Label */}
      <div
        className={`relative w-[38%] h-[38%] rounded-full bg-[#C62800] flex items-center justify-center text-white font-display font-black tracking-tight shadow-inner ${spinning ? "vinyl-spin" : ""}`}
        style={{ fontSize: size * 0.09 }}
      >
        <Disc3 className="w-4 h-4 mr-1 opacity-70" />
        {label}
      </div>
      {/* Center pin */}
      <div className="absolute w-2 h-2 rounded-full bg-[#FF3B00] nu-glow-accent" />
    </div>
  );
}
