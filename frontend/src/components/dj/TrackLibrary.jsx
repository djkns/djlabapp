import { useEffect, useState } from "react";
import { Music, Search, ChevronUp, ChevronDown } from "lucide-react";

export default function TrackLibrary({ open, onToggle }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    setLoading(true);
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks`)
      .then((r) => r.json())
      .then((data) => setTracks(Array.isArray(data) ? data : []))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const loadToDeck = (track, deckId) => {
    window.dispatchEvent(new CustomEvent("dj:load", { detail: { deckId, track } }));
  };

  const filtered = tracks.filter((t) =>
    (t.name + " " + (t.artist || "")).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div
      data-testid="track-library"
      className={`fixed left-0 right-0 bottom-0 z-50 transition-transform duration-300 ease-out ${
        open ? "translate-y-0" : "translate-y-[calc(100%-44px)]"
      }`}
    >
      {/* Toggle bar */}
      <button
        onClick={onToggle}
        data-testid="library-toggle"
        className="w-full h-11 bg-[#0a0a0a]/95 backdrop-blur-xl border-t border-white/10 flex items-center justify-between px-6 text-[10px] tracking-[0.25em] uppercase font-bold text-[#A1A1AA] hover:text-white transition-colors"
      >
        <span className="flex items-center gap-2">
          <Music className="w-3.5 h-3.5 text-[#C62800]" />
          Track Library · {tracks.length} tracks
        </span>
        <span className="flex items-center gap-2">
          {open ? "Hide" : "Browse"}
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </span>
      </button>

      {/* Panel */}
      <div className="h-[40vh] bg-[#0a0a0a]/98 backdrop-blur-2xl border-t border-white/10 overflow-hidden flex flex-col">
        <div className="p-4 flex items-center gap-3 border-b border-white/5">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute top-1/2 -translate-y-1/2 left-3 text-[#52525B]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tracks..."
              className="w-full bg-black/60 border border-white/10 rounded pl-9 pr-3 py-2 text-sm text-white placeholder:text-[#52525B] focus:outline-none focus:border-[#C62800]"
              data-testid="library-search"
            />
          </div>
          {loading && <span className="label-tiny">Loading…</span>}
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#0a0a0a] border-b border-white/5 z-10">
              <tr className="text-left label-tiny">
                <th className="px-4 py-2 font-bold">Title</th>
                <th className="px-4 py-2 font-bold">Artist</th>
                <th className="px-4 py-2 font-bold">BPM</th>
                <th className="px-4 py-2 font-bold">Source</th>
                <th className="px-4 py-2 font-bold w-48">Load to</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.key}
                  className="border-b border-white/5 hover:bg-white/[0.03] group"
                  data-testid={`library-row-${t.key}`}
                >
                  <td className="px-4 py-2.5 text-white truncate max-w-[320px]">{t.name}</td>
                  <td className="px-4 py-2.5 text-[#A1A1AA] truncate max-w-[200px]">{t.artist || "—"}</td>
                  <td className="px-4 py-2.5 font-mono-dj text-[#A1A1AA]">{t.bpm ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[9px] tracking-[0.2em] uppercase px-2 py-1 rounded border ${
                      t.source === "s3"
                        ? "border-[#C62800]/40 text-[#FF3B00] bg-[#C62800]/10"
                        : "border-white/10 text-[#A1A1AA]"
                    }`}>
                      {t.source}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      <button
                        onClick={() => loadToDeck(t, "deckA")}
                        className="px-2 py-1 rounded border border-white/15 text-[10px] font-bold tracking-widest uppercase hover:border-[#FF3B00] hover:text-[#FF3B00] transition"
                        data-testid={`load-a-${t.key}`}
                      >
                        Deck A
                      </button>
                      <button
                        onClick={() => loadToDeck(t, "deckB")}
                        className="px-2 py-1 rounded border border-white/15 text-[10px] font-bold tracking-widest uppercase hover:border-[#FF3B00] hover:text-[#FF3B00] transition"
                        data-testid={`load-b-${t.key}`}
                      >
                        Deck B
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-[#52525B] text-sm">
                  No tracks match your search.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
