import { useDJStore } from "@/store/djStore";
import { Repeat, X } from "lucide-react";

const BEAT_OPTIONS = [1, 2, 4, 8, 16];

export default function LoopControls({ deckId, getCurrentTime, seekTo, deckLetter }) {
  const deck = useDJStore((s) => s[deckId]);
  const setLoop = useDJStore((s) => s.setLoop);
  const clearLoop = useDJStore((s) => s.clearLoop);

  const currentBPM = deck.baseBPM * (1 + deck.tempoPct / 100);
  const secPerBeat = 60 / (currentBPM || 120);

  const setIn = () => setLoop(deckId, { in: getCurrentTime(), enabled: false, beats: null });
  const setOut = () => {
    const now = getCurrentTime();
    if (deck.loop.in == null || now <= deck.loop.in) return;
    setLoop(deckId, { out: now, enabled: true });
  };
  const toggleEnabled = () => {
    if (deck.loop.in != null && deck.loop.out != null) {
      setLoop(deckId, { enabled: !deck.loop.enabled });
      if (!deck.loop.enabled) seekTo(deck.loop.in);
    }
  };
  const autoLoop = (beats) => {
    const start = getCurrentTime();
    const end = start + beats * secPerBeat;
    setLoop(deckId, { in: start, out: end, enabled: true, beats });
  };

  const hasLoop = deck.loop.in != null && deck.loop.out != null;

  return (
    <div className="flex flex-col gap-1" data-testid={`loop-${deckLetter}`}>
      <div className="flex items-center justify-between">
        <span className="label-tiny">Loop</span>
        {hasLoop && (
          <button
            onClick={() => clearLoop(deckId)}
            className="text-[#52525B] hover:text-white"
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
          disabled={!deck.track}
          data-testid={`deck-${deckLetter}-loop-in`}
          className="flex-1 h-7 rounded-sm border border-white/15 text-[10px] font-bold uppercase tracking-[0.15em] hover:border-[#FF1F1F] hover:text-[#FF1F1F] transition disabled:opacity-40"
        >
          In
        </button>
        <button
          onClick={setOut}
          disabled={!deck.track || deck.loop.in == null}
          data-testid={`deck-${deckLetter}-loop-out`}
          className="flex-1 h-7 rounded-sm border border-white/15 text-[10px] font-bold uppercase tracking-[0.15em] hover:border-[#FF1F1F] hover:text-[#FF1F1F] transition disabled:opacity-40"
        >
          Out
        </button>
        <button
          onClick={toggleEnabled}
          disabled={!hasLoop}
          data-testid={`deck-${deckLetter}-loop-toggle`}
          className={`w-8 h-7 rounded-sm border text-[10px] flex items-center justify-center transition ${
            deck.loop.enabled
              ? "bg-[#D10A0A] border-[#FF1F1F] text-white shadow-[0_0_10px_#FF1F1F]"
              : "border-white/15 text-[#A1A1AA] hover:border-[#FF1F1F]"
          } disabled:opacity-40`}
        >
          <Repeat className="w-3 h-3" />
        </button>
      </div>
      <div className="flex gap-1">
        {BEAT_OPTIONS.map((b) => (
          <button
            key={b}
            onClick={() => autoLoop(b)}
            disabled={!deck.track}
            data-testid={`deck-${deckLetter}-autoloop-${b}`}
            className={`flex-1 h-6 rounded-sm text-[10px] font-bold tracking-wider border transition ${
              deck.loop.beats === b
                ? "border-[#FF1F1F] text-[#FF1F1F] bg-[#D10A0A]/20"
                : "border-white/10 text-[#A1A1AA] hover:border-white/30 hover:text-white"
            } disabled:opacity-40`}
          >
            {b}
          </button>
        ))}
      </div>
    </div>
  );
}
