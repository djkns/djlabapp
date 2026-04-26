import { useDJStore } from "@/store/djStore";
import { useShallow } from "zustand/react/shallow";
import { camelotCompat } from "@/lib/keyDetect";

/**
 * BPM + Camelot key compatibility HUD.
 *
 * Sits between the two decks (above the master) and shows, at a glance:
 *   • Each deck's *effective* BPM (baseBPM × tempo) and Camelot code
 *   • The BPM delta (% difference) — colored by sync zone
 *   • The harmonic compatibility light: HARMONIC / ENERGY / CLASH
 *
 * Intentionally read-only — no clicks, no drag affordances. Pure helper.
 */
const STATUS = {
  harmonic: { label: "HARMONIC", color: "#22c55e", glow: "rgba(34,197,94,0.45)" },
  energy:   { label: "ENERGY",   color: "#eab308", glow: "rgba(234,179,8,0.45)"  },
  clash:    { label: "CLASH",    color: "#ef4444", glow: "rgba(239,68,68,0.45)"  },
};

function pickBpmStatus(deltaPct) {
  if (deltaPct == null) return null;
  const abs = Math.abs(deltaPct);
  if (abs <= 1.0) return "harmonic"; // green: in-sync
  if (abs <= 4.0) return "energy";   // yellow: nudge needed
  return "clash";                    // red: tempo gap is too wide for a clean blend
}

function DeckSide({ label, bpm, camelot, musicalKey, accent, align = "left" }) {
  return (
    <div className={`flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}
         data-testid={`hud-deck-${label.toLowerCase()}`}>
      <span
        className="text-[10px] tracking-[0.28em] uppercase font-bold"
        style={{ color: accent }}
      >
        DECK {label}
      </span>
      <div className={`flex items-baseline gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className="font-mono-dj text-sm text-white tabular-nums"
              data-testid={`hud-deck-${label.toLowerCase()}-bpm`}>
          {bpm ? bpm.toFixed(1) : "—"}
        </span>
        <span className="text-[9px] text-[#52525B] tracking-[0.18em] uppercase">BPM</span>
      </div>
      <span
        data-testid={`hud-deck-${label.toLowerCase()}-camelot`}
        className="font-mono-dj text-[11px] px-2 py-0.5 rounded border tracking-wide"
        style={{
          color: camelot ? "#FF1F1F" : "#52525B",
          borderColor: camelot ? "rgba(209,10,10,0.4)" : "rgba(255,255,255,0.08)",
          background: camelot ? "rgba(209,10,10,0.08)" : "transparent",
        }}
        title={musicalKey ? `Key · ${musicalKey} (Camelot ${camelot})` : "Key not detected yet"}
      >
        {camelot || "—"}
      </span>
    </div>
  );
}

export default function BpmKeyHud() {
  const { aBase, aTempo, aKey, aCam, aTrack,
          bBase, bTempo, bKey, bCam, bTrack } = useDJStore(useShallow((s) => ({
    aBase: s.deckA.baseBPM, aTempo: s.deckA.tempoPct,
    aKey: s.deckA.musicalKey, aCam: s.deckA.camelot, aTrack: s.deckA.track,
    bBase: s.deckB.baseBPM, bTempo: s.deckB.tempoPct,
    bKey: s.deckB.musicalKey, bCam: s.deckB.camelot, bTrack: s.deckB.track,
  })));

  const aEff = aTrack && aBase ? aBase * (1 + (aTempo || 0) / 100) : null;
  const bEff = bTrack && bBase ? bBase * (1 + (bTempo || 0) / 100) : null;

  const bpmDelta = aEff && bEff ? ((bEff - aEff) / aEff) * 100 : null;
  const bpmStatus = pickBpmStatus(bpmDelta);
  const keyStatus = aCam && bCam ? camelotCompat(aCam, bCam) : null;

  // Final indicator: take the worst of the two — if BPM is way off, the
  // mix is hard regardless of key. Order: clash > energy > harmonic.
  const rank = { harmonic: 0, energy: 1, clash: 2 };
  let combined = null;
  const candidates = [bpmStatus, keyStatus].filter(Boolean);
  if (candidates.length) {
    combined = candidates.reduce((w, c) => (rank[c] > rank[w] ? c : w), candidates[0]);
  }
  const statusInfo = combined ? STATUS[combined] : null;

  return (
    <div
      data-testid="bpm-key-hud"
      className="flex items-center justify-center gap-4 px-4 py-1.5 mx-auto rounded-md border border-white/10 bg-black/50 backdrop-blur-sm"
      style={{ minHeight: 36 }}
    >
      <DeckSide label="A" bpm={aEff} camelot={aCam} musicalKey={aKey} accent="#FF1F1F" align="left" />

      {/* Center: compatibility light + BPM delta */}
      <div className="flex flex-col items-center gap-0.5 min-w-[110px]">
        {statusInfo ? (
          <div
            data-testid="hud-status-indicator"
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-[0.22em] uppercase"
            style={{
              color: statusInfo.color,
              background: `${statusInfo.glow}`,
              boxShadow: `0 0 10px ${statusInfo.glow}`,
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: statusInfo.color, boxShadow: `0 0 6px ${statusInfo.color}` }}
            />
            {statusInfo.label}
          </div>
        ) : (
          <div className="text-[10px] tracking-[0.22em] uppercase text-[#52525B]">— · —</div>
        )}
        <span data-testid="hud-bpm-delta" className="font-mono-dj text-[10px] text-[#A1A1AA] tabular-nums">
          {bpmDelta != null ? `Δ ${bpmDelta >= 0 ? "+" : ""}${bpmDelta.toFixed(1)}%` : "Δ —"}
        </span>
      </div>

      <DeckSide label="B" bpm={bEff} camelot={bCam} musicalKey={bKey} accent="#FF1F1F" align="right" />
    </div>
  );
}
