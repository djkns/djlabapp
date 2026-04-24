import { useEffect } from "react";
import { useDJStore } from "@/store/djStore";
import { FX_TYPES, FX_DIVISIONS } from "@/lib/fxRack";
import EQKnob from "./EQKnob";

const EFFECT_LABELS = {
  reverb:  "REVERB",
  delay:   "DELAY",
  flanger: "FLANGER",
};

const EFFECT_COLORS = {
  reverb:  "#00D4FF",
  delay:   "#FF9500",
  flanger: "#C864FF",
};

/**
 * One FX slot UI: effect selector + enable toggle + big amount knob + tempo division.
 * Slot is plugged into the deck's audio chain via chain.fx1 / chain.fx2 — we
 * subscribe to store and push commands into the node.
 */
export default function FXSlot({ deckId, slotKey, chain }) {
  const deck = useDJStore((s) => s[deckId]);
  const setFX = useDJStore((s) => s.setFX);
  const state = deck[slotKey];
  const node = chain?.[slotKey];

  const letter = deckId === "deckA" ? "a" : "b";
  const slotNum = slotKey === "fx1" ? 1 : 2;
  const color = EFFECT_COLORS[state.effect] || "#FF1F1F";

  const currentBPM = deck.baseBPM * (1 + deck.tempoPct / 100);

  // Sync store → audio node
  useEffect(() => { node?.setEffect?.(state.effect); }, [node, state.effect]);
  useEffect(() => { node?.setEnabled?.(state.enabled); }, [node, state.enabled]);
  useEffect(() => { node?.setAmount?.(state.amount); }, [node, state.amount]);
  useEffect(() => { node?.setTempoSync?.(currentBPM, state.division); }, [node, currentBPM, state.division]);

  const canShowDivision = state.effect === "delay" || state.effect === "flanger";

  return (
    <div className="flex flex-col gap-1 p-1.5 rounded border border-white/10 bg-black/40"
         data-testid={`deck-${letter}-${slotKey}`}
         style={state.enabled ? { boxShadow: `inset 0 0 8px ${color}33, 0 0 6px ${color}66` } : {}}>
      <div className="flex items-center justify-between gap-1">
        <span className="label-tiny" style={{ color: state.enabled ? color : "#A1A1AA" }}>FX</span>
        <button
          data-testid={`deck-${letter}-${slotKey}-toggle`}
          onClick={() => setFX(deckId, slotKey, { enabled: !state.enabled })}
          className={`w-5 h-5 rounded-full border transition flex items-center justify-center text-[8px] font-bold ${
            state.enabled
              ? "bg-[#D10A0A] border-[#FF1F1F] text-white shadow-[0_0_8px_#FF1F1F]"
              : "border-white/20 text-[#A1A1AA] hover:border-white/50"
          }`}
          title={state.enabled ? "Disable effect" : "Enable effect"}
        >
          {state.enabled ? "●" : "○"}
        </button>
      </div>

      <select
        data-testid={`deck-${letter}-${slotKey}-effect`}
        value={state.effect}
        onChange={(e) => setFX(deckId, slotKey, { effect: e.target.value })}
        className="w-full bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white focus:outline-none focus:border-[#D10A0A]"
        style={{ color: state.enabled ? color : undefined }}
      >
        {FX_TYPES.map((t) => <option key={t} value={t}>{EFFECT_LABELS[t]}</option>)}
      </select>

      <div className="flex items-center justify-center">
        <EQKnob
          label=""
          value={state.amount}
          min={0}
          max={1}
          onChange={(v) => setFX(deckId, slotKey, { amount: v })}
          testid={`deck-${letter}-${slotKey}-amount`}
          color={color}
          size={40}
        />
      </div>

      {canShowDivision ? (
        <select
          data-testid={`deck-${letter}-${slotKey}-division`}
          value={state.division}
          onChange={(e) => setFX(deckId, slotKey, { division: e.target.value })}
          className="w-full bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#A1A1AA] focus:outline-none focus:border-[#D10A0A]"
          title="Tempo-synced division"
        >
          {FX_DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      ) : (
        <div className="h-[18px]" />
      )}
    </div>
  );
}
