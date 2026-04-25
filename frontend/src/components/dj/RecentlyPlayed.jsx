import { useCallback, useEffect, useState } from "react";
import { Music, Clock } from "lucide-react";

/**
 * Horizontal "RECENTLY PLAYED" strip.
 *  • Polls /api/tracks/recent on mount + whenever a deck reports a track
 *    crossed the 30s threshold (dj:track-played event).
 *  • Each card is draggable onto a deck (same payload as the library rows)
 *    so the workflow is consistent: drag → drop → load.
 *  • Hover reveals A / B quick-load buttons.
 */
export default function RecentlyPlayed({ limit = 10 }) {
  const [items, setItems] = useState([]);

  const fetchRecent = useCallback(async () => {
    try {
      const r = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks/recent?limit=${limit}`);
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data)) setItems(data);
    } catch { /* ignore */ }
  }, [limit]);

  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  useEffect(() => {
    const h = () => fetchRecent();
    window.addEventListener("dj:track-played", h);
    return () => window.removeEventListener("dj:track-played", h);
  }, [fetchRecent]);

  const loadTo = (track, deckId) => {
    window.dispatchEvent(new CustomEvent("dj:load", { detail: { deckId, track } }));
  };

  const onDragStart = (track) => (e) => {
    e.dataTransfer.setData("application/x-djlab-track", JSON.stringify(track));
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div data-testid="recently-played"
         className="border-t border-white/5 bg-[#0a0a0a]/70 px-3 py-2 pb-12 shrink-0">
      <div className="flex items-center gap-2 mb-1.5">
        <Clock className="w-3 h-3 text-[#FF1F1F]" />
        <span className="label-tiny tracking-[0.25em]">RECENTLY PLAYED</span>
        <span className="text-[9px] text-[#52525B]">· counts after 30s · drag onto a deck</span>
      </div>
      {items.length === 0 ? (
        <div className="text-[#52525B] text-xs italic h-[52px] flex items-center">
          Nothing played yet — load a track and let it run for 30 seconds.
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "thin" }}>
          {items.map((t) => (
            <div
              key={t.key}
              draggable
              onDragStart={onDragStart(t)}
              data-testid={`recent-${t.key}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded border border-white/10 bg-[#1a1a1a]/70 hover:border-[#D10A0A]/50 hover:bg-[#1a1a1a] transition-all cursor-grab active:cursor-grabbing group shrink-0"
              style={{ minWidth: 200, maxWidth: 240 }}
              title="Drag onto a deck to reload"
            >
              {t.cover ? (
                <img src={t.cover} alt="" draggable={false}
                     className="w-9 h-9 rounded object-cover border border-black/40 shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded bg-[#0a0a0a] border border-white/10 flex items-center justify-center shrink-0">
                  <Music className="w-3.5 h-3.5 text-[#52525B]" />
                </div>
              )}
              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-[11px] text-white truncate">{t.title || t.name}</div>
                <div className="text-[10px] text-[#A1A1AA] truncate">{t.artist || "—"}</div>
              </div>
              <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={() => loadTo(t, "deckA")}
                  data-testid={`recent-load-a-${t.key}`}
                  className="px-1.5 py-0 rounded border border-white/15 text-[9px] font-bold tracking-widest uppercase hover:border-[#FF1F1F] hover:text-[#FF1F1F]"
                >A</button>
                <button
                  onClick={() => loadTo(t, "deckB")}
                  data-testid={`recent-load-b-${t.key}`}
                  className="px-1.5 py-0 rounded border border-white/15 text-[9px] font-bold tracking-widest uppercase hover:border-[#FF1F1F] hover:text-[#FF1F1F]"
                >B</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
