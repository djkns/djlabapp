import { useDJStore } from "@/store/djStore";

const SLOT_COLORS = [
  "#FF1F1F", "#FF9500", "#FFE500", "#2ECC71",
  "#00D4FF", "#4C6EF5", "#C264FF", "#FF3BA7",
];

export default function HotCuePad({ deckId, getCurrentTime, seekTo, deckLetter }) {
  // Only subscribe to hotCues + track presence — not the whole deck object.
  const hotCues = useDJStore((s) => s[deckId].hotCues);
  const hasTrack = useDJStore((s) => !!s[deckId].track);
  const setHotCue = useDJStore((s) => s.setHotCue);
  const clearHotCue = useDJStore((s) => s.clearHotCue);

  const onSlotClick = (i, e) => {
    if (!hasTrack) return;
    if (e.shiftKey) {
      clearHotCue(deckId, i);
      return;
    }
    const existing = hotCues[i];
    if (existing == null) {
      setHotCue(deckId, i, getCurrentTime());
    } else {
      seekTo(existing);
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid={`hotcue-pad-${deckLetter}`}>
      <span className="label-tiny truncate" title="Shift+click to clear">Hot Cues</span>
      <div className="grid grid-cols-4 gap-1">
        {hotCues.map((v, i) => {
          const set = v != null;
          const color = SLOT_COLORS[i] || "#FF1F1F";
          return (
            <button
              key={i}
              data-testid={`deck-${deckLetter}-cue-${i + 1}`}
              onClick={(e) => onSlotClick(i, e)}
              disabled={!hasTrack}
              className="relative h-7 rounded-sm font-display font-black text-xs flex items-center justify-center transition-all border-2 disabled:cursor-not-allowed overflow-hidden group"
              style={{
                background: set ? color : "#141414",
                borderColor: set ? color : (hasTrack ? `${color}66` : "rgba(255,255,255,0.15)"),
                color: set ? "#000" : (hasTrack ? "#FFFFFF" : "rgba(255,255,255,0.3)"),
                boxShadow: set ? `0 0 12px ${color}bb, inset 0 0 8px ${color}55` : "none",
                opacity: hasTrack ? 1 : 0.45,
              }}
              title={set ? `${v.toFixed(2)}s — click to jump, shift+click clears` : "Click to set cue here"}
            >
              {/* subtle fill hint on hover when empty */}
              {!set && hasTrack && (
                <span
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: `${color}22` }}
                />
              )}
              <span className="relative">{i + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
