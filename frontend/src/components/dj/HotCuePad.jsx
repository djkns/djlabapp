import { useDJStore } from "@/store/djStore";

const SLOT_COLORS = [
  "#FF1F1F", "#FF9500", "#FFE500", "#2ECC71",
  "#00D4FF", "#4C6EF5", "#C264FF", "#FF3BA7",
];

export default function HotCuePad({ deckId, getCurrentTime, seekTo, deckLetter }) {
  const deck = useDJStore((s) => s[deckId]);
  const setHotCue = useDJStore((s) => s.setHotCue);
  const clearHotCue = useDJStore((s) => s.clearHotCue);

  const onSlotClick = (i, e) => {
    if (!deck.track) return;
    if (e.shiftKey) {
      clearHotCue(deckId, i);
      return;
    }
    const existing = deck.hotCues[i];
    if (existing == null) {
      setHotCue(deckId, i, getCurrentTime());
    } else {
      seekTo(existing);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid={`hotcue-pad-${deckLetter}`}>
      <span className="label-tiny">Hot Cues · shift+click to clear</span>
      <div className="grid grid-cols-4 gap-1.5">
        {deck.hotCues.map((v, i) => {
          const set = v != null;
          const color = SLOT_COLORS[i] || "#FF1F1F";
          return (
            <button
              key={i}
              data-testid={`deck-${deckLetter}-cue-${i + 1}`}
              onClick={(e) => onSlotClick(i, e)}
              disabled={!deck.track}
              className="relative h-9 rounded-sm font-display font-black text-xs flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed border"
              style={{
                background: set ? color : "rgba(255,255,255,0.03)",
                borderColor: set ? color : "rgba(255,255,255,0.12)",
                color: set ? "#000" : "rgba(255,255,255,0.5)",
                boxShadow: set ? `0 0 10px ${color}99` : "none",
              }}
              title={set ? `${v.toFixed(2)}s — click to jump, shift+click to clear` : "Click to set cue here"}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
