import { useDJStore } from "@/store/djStore";
import { useShallow } from "zustand/react/shallow";
import { Repeat, X } from "lucide-react";

const BEAT_OPTIONS = [1, 2, 4, 8, 16];

export default function LoopControls({ deckId, getCurrentTime, seekTo, deckLetter }) {
  // Only subscribe to the specific fields used here.
  const { baseBPM, tempoPct, loop, hasTrack } = useDJStore(useShallow((s) => ({
    baseBPM: s[deckId].baseBPM,
    tempoPct: s[deckId].tempoPct,
    loop: s[deckId].loop,
    hasTrack: !!s[deckId].track,
  })));
  const setLoop = useDJStore((s) => s.setLoop);
  const clearLoop = useDJStore((s) => s.clearLoop);

  const currentBPM = baseBPM * (1 + tempoPct / 100);
  const secPerBeat = 60 / (currentBPM || 120);

  const hasIn = loop.in != null;
  const hasOut = loop.out != null;
  const hasLoop = hasIn && hasOut;

  const setIn = () => setLoop(deckId, { in: getCurrentTime(), enabled: false, beats: null });
  const setOut = () => {
    const now = getCurrentTime();
    if (!hasIn || now <= loop.in) return;
    setLoop(deckId, { out: now, enabled: true });
  };
  const toggleEnabled = () => {
    if (hasLoop) {
      setLoop(deckId, { enabled: !loop.enabled });
      if (!loop.enabled) seekTo(loop.in);
    }
  };
  const autoLoop = (beats) => {
    const start = getCurrentTime();
    const end = start + beats * secPerBeat;
    setLoop(deckId, { in: start, out: end, enabled: true, beats });
  };

  // button shared styles
  const baseBtn = "flex-1 h-7 rounded-sm border-2 text-[10px] font-bold uppercase tracking-[0.15em] transition";
  const armedBtn = "border-white/30 text-white bg-white/[0.04] hover:border-[#FF1F1F] hover:text-[#FF1F1F] hover:bg-[#D10A0A]/10";
  const activeBtn = "border-[#FF1F1F] text-[#FF1F1F] bg-[#D10A0A]/25 shadow-[0_0_10px_#FF1F1F55]";
  const idleBtn = "border-white/10 text-[#52525B] cursor-not-allowed";

  return (
    <div className="flex flex-col gap-1" data-testid={`loop-${deckLetter}`}>
      <div className="flex items-center justify-between">
        <span className="label-tiny">Loop</span>
        {hasLoop && (
          <button
            onClick={() => clearLoop(deckId)}
            className="text-[#A1A1AA] hover:text-[#FF1F1F]"
            title="Exit loop"
            data-testid={`deck-${deckLetter}-loop-exit`}
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex gap-1">
        <button
          onClick={setIn}
          disabled={!hasTrack}
          data-testid={`deck-${deckLetter}-loop-in`}
          className={`${baseBtn} ${!hasTrack ? idleBtn : (hasIn ? activeBtn : armedBtn)}`}
          title={hasIn ? `IN @ ${loop.in.toFixed(2)}s` : "Set loop IN at current position"}
        >
          In
        </button>
        <button
          onClick={setOut}
          disabled={!hasTrack || !hasIn}
          data-testid={`deck-${deckLetter}-loop-out`}
          className={`${baseBtn} ${(!hasTrack || !hasIn) ? idleBtn : (hasOut ? activeBtn : armedBtn)}`}
          title={hasOut ? `OUT @ ${loop.out.toFixed(2)}s` : (hasIn ? "Set loop OUT" : "Set loop IN first")}
        >
          Out
        </button>
        <button
          onClick={toggleEnabled}
          disabled={!hasLoop}
          data-testid={`deck-${deckLetter}-loop-toggle`}
          className={`w-8 h-7 rounded-sm border-2 flex items-center justify-center transition ${
            !hasLoop
              ? "border-white/10 text-[#52525B] cursor-not-allowed"
              : loop.enabled
                ? "bg-[#D10A0A] border-[#FF1F1F] text-white shadow-[0_0_12px_#FF1F1F]"
                : "border-white/30 text-white hover:border-[#FF1F1F] hover:text-[#FF1F1F]"
          }`}
          title={loop.enabled ? "Disable loop" : "Enable loop"}
        >
          <Repeat className="w-3 h-3" />
        </button>
      </div>
      <div className="flex gap-1">
        {BEAT_OPTIONS.map((b) => (
          <button
            key={b}
            onClick={() => autoLoop(b)}
            disabled={!hasTrack}
            data-testid={`deck-${deckLetter}-autoloop-${b}`}
            className={`flex-1 h-6 rounded-sm text-[10px] font-bold tracking-wider border-2 transition ${
              !hasTrack
                ? idleBtn
                : loop.beats === b && loop.enabled
                  ? "border-[#FF1F1F] text-[#FF1F1F] bg-[#D10A0A]/25 shadow-[0_0_10px_#FF1F1F55]"
                  : "border-white/25 text-white bg-white/[0.03] hover:border-[#FF1F1F] hover:text-[#FF1F1F] hover:bg-[#D10A0A]/10"
            }`}
            title={`Auto-loop ${b} beats`}
          >
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}
