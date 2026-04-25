import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { getAudioContext } from "@/lib/audioEngine";

/**
 * Live latency readout. `baseLatency` (browser → audio thread) +
 * `outputLatency` (audio thread → speaker). We poll lazily because outputLatency
 * stabilises after a few seconds of playback.
 */
export default function LatencyReadout() {
  const [ms, setMs] = useState(null);

  useEffect(() => {
    const tick = () => {
      try {
        const { ctx } = getAudioContext();
        if (!ctx) return;
        const base = ctx.baseLatency || 0;
        const out = ctx.outputLatency || 0;
        const total = (base + out) * 1000;
        if (total > 0) setMs(total);
      } catch { /* AudioContext not yet created */ }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

  if (ms == null) return null;
  const color = ms < 25 ? "#22c55e" : ms < 50 ? "#eab308" : "#FF1F1F";
  return (
    <div
      data-testid="latency-readout"
      className="flex items-center gap-1 px-2 py-1 rounded border border-white/10 bg-black/40"
      title={`Web Audio output latency: ${ms.toFixed(1)}ms (lower is better)`}
    >
      <Activity className="w-3 h-3" style={{ color }} />
      <span className="font-mono-dj text-[10px] tracking-wide" style={{ color }}>
        {ms.toFixed(0)}MS
      </span>
    </div>
  );
}
