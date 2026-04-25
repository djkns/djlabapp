import { useCallback, useEffect, useState } from "react";
import { Music, Clock } from "lucide-react";

/**
 * Per-deck RECENTLY PLAYED list. Lives inside the deck card, in the empty
 * space below the FX rack. Filters server-side by deck so Deck A only shows
 * tracks that played on Deck A.
 *
 * Each card is draggable + click-to-load (one-tap reload onto the same deck).
 */
export default function RecentlyPlayed({ deckId, deckLabel = "A", limit = 8 }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchRecent = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/api/tracks/recent?deck=${deckLabel}&limit=${limit}`
      );
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data)) setItems(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [deckLabel, limit]);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  useEffect(() => {
    const h = (e) => {
      // Refresh whenever any deck just crossed 30s, but only update OUR list
      // if this deck or shared.
      if (!e.detail?.deck || e.detail.deck === deckLabel) fetchRecent();
    };
    window.addEventListener("dj:track-played", h);
    return () => window.removeEventListener("dj:track-played", h);
  }, [fetchRecent, deckLabel]);

  const loadHere = (track) => {
    window.dispatchEvent(new CustomEvent("dj:load", { detail: { deckId, track } }));
  };

  const onDragStart = (track) => (e) => {
    e.dataTransfer.setData("application/x-djlab-track", JSON.stringify(track));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div data-testid={`deck-${deckLabel.toLowerCase()}-recent`}
         className="mt-2 rounded border border-white/10 bg-black/40 overflow-hidden flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-white/5 shrink-0">
        <Clock className="w-3 h-3 text-[#FF1F1F]" />
        <span className="label-tiny tracking-[0.25em]">DECK {deckLabel} · RECENT</span>
        <span className="text-[9px] text-[#52525B] ml-auto">click or drag</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto"
           style={{ scrollbarWidth: "thin", scrollbarColor: "#3f3f46 transparent" }}>
        {items.length === 0 ? (
          <div className="text-[#52525B] text-[11px] italic px-3 py-3">
            {loading ? "Loading…" : "Nothing yet — track must play 30s to land here."}
          </div>
        ) : (
          items.map((t) => (
            <div
              key={t.key}
              draggable
              onDragStart={onDragStart(t)}
              onClick={() => loadHere(t)}
              data-testid={`deck-${deckLabel.toLowerCase()}-recent-${t.key}`}
              className="flex items-center gap-2 px-2 py-1 border-b border-white/5 hover:bg-white/[0.04] cursor-grab active:cursor-grabbing"
              title="Click to load on this deck · drag onto the other deck"
            >
              {t.cover ? (
                <img src={t.cover} alt="" draggable={false}
                     className="w-7 h-7 rounded object-cover border border-white/10 shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded bg-[#1a1a1a] border border-white/10 flex items-center justify-center shrink-0">
                  <Music className="w-3 h-3 text-[#52525B]" />
                </div>
              )}
              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-[11px] text-white truncate">{t.title || t.name}</div>
                <div className="text-[9px] text-[#A1A1AA] truncate">{t.artist || "—"}</div>
              </div>
              {t.bpm && (
                <span className="font-mono-dj text-[9px] text-[#A1A1AA] shrink-0">
                  {t.bpm.toFixed(0)}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
