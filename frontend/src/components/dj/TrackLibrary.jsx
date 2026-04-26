import { useEffect, useMemo, useRef, useState } from "react";
import { Music, Search, ChevronUp, ChevronDown, Clock, Target } from "lucide-react";
import { List as VList } from "react-window";
import { useDJStore } from "@/store/djStore";
import RecentlyPlayed from "./RecentlyPlayed";
import LibraryPrecacher from "./LibraryPrecacher";

const ROW_HEIGHT = 44;
const MATCH_TOLERANCES = [0.03, 0.06, 0.1]; // 3% / 6% / 10%
const MATCH_LABELS = ["±3%", "±6%", "±10%"];

/**
 * Virtualised track library.
 *  • Search filters live by title / artist / album (case-insensitive).
 *  • Match Mode (Deck A / Deck B) filters to BPM-compatible tracks for that
 *    deck's *current* tempo (baseBPM × tempoPct). Sorted by closeness so the
 *    best mixes float to the top.
 *  • Only visible rows are rendered (react-window).
 *  • Each row is draggable: drop it on a Deck panel to load the track.
 */
export default function TrackLibrary({ open, onToggle }) {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("library"); // "library" | "recentA" | "recentB"
  const [matchDeck, setMatchDeck] = useState(null); // null | "deckA" | "deckB"
  const [tolIdx, setTolIdx] = useState(1); // index into MATCH_TOLERANCES
  const containerRef = useRef(null);
  const [containerH, setContainerH] = useState(360);

  // Live BPM of each deck (baseBPM scaled by tempo pitch). Subscribing to the
  // raw fields keeps this filter reactive: bend Deck A's tempo and the Match
  // list re-sorts itself in real time.
  const deckABase = useDJStore((s) => s.deckA.baseBPM);
  const deckATempo = useDJStore((s) => s.deckA.tempoPct);
  const deckBBase = useDJStore((s) => s.deckB.baseBPM);
  const deckBTempo = useDJStore((s) => s.deckB.tempoPct);
  const deckATrack = useDJStore((s) => s.deckA.track);
  const deckBTrack = useDJStore((s) => s.deckB.track);
  const deckABPM = deckABase * (1 + deckATempo / 100);
  const deckBBPM = deckBBase * (1 + deckBTempo / 100);

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
  }, [open, tab]);

  // Auto-disable Match Mode if its target deck loses its track
  useEffect(() => {
    if (matchDeck === "deckA" && !deckATrack) setMatchDeck(null);
    if (matchDeck === "deckB" && !deckBTrack) setMatchDeck(null);
  }, [matchDeck, deckATrack, deckBTrack]);

  const loadToDeck = (track, deckId) => {
    window.dispatchEvent(new CustomEvent("dj:load", { detail: { deckId, track } }));
  };

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let list = ql
      ? tracks.filter((t) =>
          (t.name + " " + (t.artist || "") + " " + (t.album || "")).toLowerCase().includes(ql)
        )
      : tracks;

    if (matchDeck) {
      const target = matchDeck === "deckA" ? deckABPM : deckBBPM;
      const tol = MATCH_TOLERANCES[tolIdx];
      if (target && isFinite(target) && target > 0) {
        list = list
          .filter((t) => t.bpm && Math.abs(t.bpm - target) / target <= tol)
          .map((t) => ({ ...t, _matchDelta: Math.abs(t.bpm - target) }))
          .sort((a, b) => a._matchDelta - b._matchDelta);
      }
    }
    return list;
  }, [tracks, q, matchDeck, tolIdx, deckABPM, deckBBPM]);

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

      <div className="h-[60vh] bg-[#0a0a0a]/98 backdrop-blur-2xl border-t border-white/10 overflow-hidden flex flex-col">
        {/* Tab strip */}
        <div className="flex items-center gap-1 px-3 pt-2 border-b border-white/5">
          {[
            { k: "library", label: `Library · ${tracks.length}`, icon: Music },
            { k: "recentA", label: "Recent A", icon: Clock },
            { k: "recentB", label: "Recent B", icon: Clock },
          ].map(({ k, label, icon: Icon }) => (
            <button
              key={k}
              data-testid={`library-tab-${k}`}
              onClick={() => setTab(k)}
              className={`flex items-center gap-1.5 text-[10px] tracking-[0.22em] uppercase font-bold px-3 py-1.5 rounded-t border-b-2 transition ${
                tab === k
                  ? "border-[#FF1F1F] text-white bg-white/[0.04]"
                  : "border-transparent text-[#A1A1AA] hover:text-white"
              }`}
            >
              <Icon className={`w-3 h-3 ${tab === k ? "text-[#FF1F1F]" : ""}`} />
              {label}
            </button>
          ))}
        </div>

        {tab === "library" ? (
          <>
            <LibraryPrecacher
              tracks={tracks}
              onMetaUpdated={(key, patch) => {
                setTracks((prev) => prev.map((t) => (t.key === key ? {
                  ...t,
                  bpm: patch.bpm ?? t.bpm,
                  title: patch.title ?? t.title,
                  artist: patch.artist ?? t.artist,
                  album: patch.album ?? t.album,
                  cover: patch.cover ?? t.cover,
                } : t)));
              }}
            />
            {/* Match Mode strip — filter to BPM-compatible tracks for a deck */}
            <div
              data-testid="match-mode"
              className="px-3 py-2 border-b border-white/5 flex items-center gap-2 flex-wrap"
            >
              <Target className="w-3.5 h-3.5 text-[#00D4FF]" />
              <span className="label-tiny text-[#A1A1AA]">MATCH</span>
              {[
                { id: null, label: "Off", bpm: null, sub: null, hasTrack: true },
                { id: "deckA", label: "Deck A", bpm: deckABPM, sub: deckATrack?.name || "—", hasTrack: !!deckATrack },
                { id: "deckB", label: "Deck B", bpm: deckBBPM, sub: deckBTrack?.name || "—", hasTrack: !!deckBTrack },
              ].map((opt) => {
                const active = matchDeck === opt.id;
                const disabled = opt.id !== null && (!opt.hasTrack || !opt.bpm || !isFinite(opt.bpm));
                return (
                  <button
                    key={opt.label}
                    data-testid={`match-${opt.id || "off"}`}
                    disabled={disabled}
                    onClick={() => setMatchDeck(opt.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] tracking-[0.22em] uppercase font-bold transition ${
                      active
                        ? "border-[#00D4FF] text-[#00D4FF] bg-[#00D4FF]/10 shadow-[0_0_8px_#00D4FF55]"
                        : disabled
                          ? "border-white/5 text-[#52525B] cursor-not-allowed"
                          : "border-white/15 text-[#A1A1AA] hover:text-white hover:border-white/40"
                    }`}
                    title={opt.id && opt.bpm ? `${opt.bpm.toFixed(1)} BPM · ${opt.sub}` : "Match disabled"}
                  >
                    {opt.label}
                    {opt.id && opt.bpm ? (
                      <span className="font-mono-dj normal-case tracking-normal text-[10px]">
                        {opt.bpm.toFixed(0)}
                      </span>
                    ) : null}
                  </button>
                );
              })}

              {/* Tolerance selector — only meaningful when a match deck is on */}
              <div className={`flex items-center gap-1 ml-2 transition-opacity ${matchDeck ? "opacity-100" : "opacity-30"}`}>
                <span className="label-tiny text-[#52525B]">TOL</span>
                {MATCH_LABELS.map((lbl, i) => (
                  <button
                    key={lbl}
                    data-testid={`match-tol-${i}`}
                    disabled={!matchDeck}
                    onClick={() => setTolIdx(i)}
                    className={`px-2 py-0.5 rounded border text-[10px] font-mono-dj transition ${
                      tolIdx === i && matchDeck
                        ? "border-[#00D4FF]/60 text-[#00D4FF] bg-[#00D4FF]/10"
                        : "border-white/10 text-[#A1A1AA] hover:text-white"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              {matchDeck && (
                <span className="ml-auto text-xs text-[#A1A1AA]">
                  <span className="font-mono-dj text-[#00D4FF]">{filtered.length}</span> compatible
                </span>
              )}
            </div>
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
                  className="dj-scroll"
                  style={{ height: containerH || 360 }}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 p-3 flex flex-col">
            <RecentlyPlayed
              deckId={tab === "recentA" ? "deckA" : "deckB"}
              deckLabel={tab === "recentA" ? "A" : "B"}
              limit={50}
            />
          </div>
        )}
      </div>
    </div>
  );
}
