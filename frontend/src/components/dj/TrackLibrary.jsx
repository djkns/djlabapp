import { useEffect, useMemo, useRef, useState } from "react";
import { Music, Search, ChevronUp, ChevronDown } from "lucide-react";
import { List as VList } from "react-window";

const ROW_HEIGHT = 44;

/**
 * Virtualised track library.
 *  • Search filters live by title / artist / album (case-insensitive).
 *  • Only visible rows are rendered (react-window) — solves the 1,725-row DOM
 *    bloat that was lagging the panel + slowing fader drags.
 *  • Each row is draggable: drop it on a Deck panel to load the track.
 */
export default function TrackLibrary({ open, onToggle }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const containerRef = useRef(null);
  const [containerH, setContainerH] = useState(360);

  useEffect(() => {
    setLoading(true);
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks`)
      .then((r) => r.json())
      .then((data) => setTracks(Array.isArray(data) ? data : []))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  // Track container height for the virtualiser
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerH(entry.contentRect.height);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [open]);

  const loadToDeck = (track, deckId) => {
    window.dispatchEvent(new CustomEvent("dj:load", { detail: { deckId, track } }));
  };

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return tracks;
    return tracks.filter((t) =>
      (t.name + " " + (t.artist || "") + " " + (t.album || "")).toLowerCase().includes(ql)
    );
  }, [tracks, q]);

  const onDragStart = (track) => (e) => {
    // Send a JSON blob the deck's onDrop handler knows how to parse.
    e.dataTransfer.setData("application/x-djlab-track", JSON.stringify(track));
    e.dataTransfer.effectAllowed = "copy";
  };

  const Row = ({ index, style }) => {
    const t = filtered[index];
    if (!t) return null;
    return (
      <div
        style={style}
        className="flex items-center gap-3 px-4 border-b border-white/5 hover:bg-white/[0.04] group cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={onDragStart(t)}
        data-testid={`library-row-${t.key}`}
        title="Drag onto a deck to load"
      >
        {t.cover ? (
          <img src={t.cover} alt="" className="w-7 h-7 rounded object-cover shrink-0 border border-white/10" />
        ) : (
          <div className="w-7 h-7 rounded bg-[#1a1a1a] border border-white/10 flex items-center justify-center shrink-0">
            <Music className="w-3 h-3 text-[#52525B]" />
          </div>
        )}
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-sm text-white truncate">{t.name}</span>
          <span className="text-xs text-[#A1A1AA] truncate">
            {t.artist || (t.album ? <em className="text-[#52525B]">{t.album}</em> : "—")}
          </span>
        </div>
        <span className="font-mono-dj text-xs text-[#A1A1AA] w-12 text-right">{t.bpm ? t.bpm.toFixed(0) : "—"}</span>
        <span className={`text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 rounded border ${
          t.source === "s3"
            ? "border-[#D10A0A]/40 text-[#FF1F1F] bg-[#D10A0A]/10"
            : "border-white/10 text-[#A1A1AA]"
        }`}>{t.source}</span>
        <div className="flex gap-1.5 opacity-60 group-hover:opacity-100 transition">
          <button
            onClick={() => loadToDeck(t, "deckA")}
            className="px-2 py-0.5 rounded border border-white/15 text-[10px] font-bold tracking-widest uppercase hover:border-[#FF1F1F] hover:text-[#FF1F1F] transition"
            data-testid={`load-a-${t.key}`}
          >A</button>
          <button
            onClick={() => loadToDeck(t, "deckB")}
            className="px-2 py-0.5 rounded border border-white/15 text-[10px] font-bold tracking-widest uppercase hover:border-[#FF1F1F] hover:text-[#FF1F1F] transition"
            data-testid={`load-b-${t.key}`}
          >B</button>
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="track-library"
      className={`fixed left-0 right-0 bottom-0 z-50 transition-transform duration-300 ease-out ${
        open ? "translate-y-0" : "translate-y-[calc(100%-44px)]"
      }`}
    >
      <button
        onClick={onToggle}
        data-testid="library-toggle"
        className="w-full h-11 bg-[#0a0a0a]/95 backdrop-blur-xl border-t border-white/10 flex items-center justify-between px-6 text-[10px] tracking-[0.25em] uppercase font-bold text-[#A1A1AA] hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          <Music className="w-3.5 h-3.5 text-[#D10A0A]" />
          Track Library · {tracks.length} tracks
          {q && filtered.length !== tracks.length && (
            <span className="text-[#FF1F1F]">· {filtered.length} matches</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {open ? "Hide" : "Browse"}
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </span>
      </button>

      <div className="h-[40vh] bg-[#0a0a0a]/98 backdrop-blur-2xl border-t border-white/10 overflow-hidden flex flex-col">
        <div className="p-3 flex items-center gap-3 border-b border-white/5">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 left-3 text-[#52525B]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title / artist / album…"
              className="w-full bg-black/60 border border-white/10 rounded pl-9 pr-3 py-2 text-sm text-white placeholder:text-[#52525B] focus:outline-none focus:border-[#D10A0A]"
              data-testid="library-search"
            />
          </div>
          <span className="label-tiny text-[#52525B]">{loading ? "Loading…" : "Drag a row onto a deck"}</span>
        </div>

        <div className="px-4 py-1.5 border-b border-white/5 flex items-center gap-3 text-[#52525B] label-tiny">
          <span className="w-7"></span>
          <span className="flex-1">Title · Artist</span>
          <span className="w-12 text-right">BPM</span>
          <span className="w-10 text-center">Src</span>
          <span className="w-14 text-right">Load</span>
        </div>

        <div ref={containerRef} className="flex-1 min-h-0">
          {filtered.length === 0 ? (
            <div className="px-4 py-12 text-center text-[#52525B] text-sm">
              {loading ? "Loading…" : "No tracks match your search."}
            </div>
          ) : (
            <VList
              rowComponent={Row}
              rowCount={filtered.length}
              rowHeight={ROW_HEIGHT}
              rowProps={{}}
              style={{ height: containerH || 360 }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
