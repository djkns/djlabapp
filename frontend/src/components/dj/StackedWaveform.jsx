import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { useDJStore } from "@/store/djStore";

/**
 * Stacked dual-waveform beat-grid preview.
 * - Deck A (blue) on top, Deck B (red) on bottom.
 * - Centered vertical playhead line through both.
 * - Each wavesurfer loads the track URL independently (its own hidden audio
 *   element, never played / kept muted) to render peaks reliably. We sync
 *   the visual scroll position to each deck's currentTime via rAF so the
 *   stacked view stays aligned with playback on both decks.
 */
export default function StackedWaveform() {
  const containerA = useRef(null);
  const containerB = useRef(null);
  const wsARef = useRef(null);
  const wsBRef = useRef(null);

  const deckATrack = useDJStore((s) => s.deckA.track);
  const deckBTrack = useDJStore((s) => s.deckB.track);

  const baseOpts = {
    cursorColor: "transparent",
    cursorWidth: 0,
    barWidth: 2,
    barRadius: 2,
    barGap: 1,
    height: 28,
    normalize: true,
    interact: false,
    autoScroll: true,
    autoCenter: true,
    minPxPerSec: 60,
    hideScrollbar: true,
    fillParent: false,
  };

  // Create both wavesurfers on mount (no media — they own their own muted audio)
  useEffect(() => {
    if (containerA.current && !wsARef.current) {
      wsARef.current = WaveSurfer.create({
        ...baseOpts,
        container: containerA.current,
        waveColor: "rgba(96, 165, 250, 0.55)",
        progressColor: "#60A5FA",
      });
      try { wsARef.current.setMuted(true); } catch { /* v7: setMuted ok */ }
    }
    if (containerB.current && !wsBRef.current) {
      wsBRef.current = WaveSurfer.create({
        ...baseOpts,
        container: containerB.current,
        waveColor: "rgba(248, 113, 113, 0.55)",
        progressColor: "#F87171",
      });
      try { wsBRef.current.setMuted(true); } catch { /* v7: setMuted ok */ }
    }
    return () => {
      wsARef.current?.destroy(); wsARef.current = null;
      wsBRef.current?.destroy(); wsBRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload peaks whenever a deck loads a new URL
  useEffect(() => {
    const h = (e) => {
      const { deckId, url } = e.detail || {};
      if (!url) return;
      const ws = deckId === "deckA" ? wsARef.current : wsBRef.current;
      if (!ws) return;
      ws.load(url).catch(() => { /* ignore — deck's own ws still drives playback */ });
    };
    window.addEventListener("dj:track-loaded", h);
    return () => window.removeEventListener("dj:track-loaded", h);
  }, []);

  // Sync scroll position to each deck's currentTime via rAF
  useEffect(() => {
    let raf;
    const loop = () => {
      const sA = useDJStore.getState().deckA;
      const sB = useDJStore.getState().deckB;
      try { if (wsARef.current && sA.duration) wsARef.current.setTime(sA.currentTime || 0); } catch { /* noop */ }
      try { if (wsBRef.current && sB.duration) wsBRef.current.setTime(sB.currentTime || 0); } catch { /* noop */ }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const labelTrack = (t) => (t ? `${t.name}${t.artist ? ` · ${t.artist}` : ""}` : "— no track —");

  return (
    <div data-testid="stacked-waveform"
         className="relative px-3 pt-1 pb-1 border-b border-white/5 bg-[#0a0a0a]/60 shrink-0">
      <div className="flex items-center justify-between mb-0.5 leading-none">
        <span className="label-tiny truncate max-w-[40%]" style={{ color: "#60A5FA" }}>
          <span className="opacity-70">DECK A · </span>
          <span className="text-white/90">{labelTrack(deckATrack)}</span>
        </span>
        <span className="label-tiny text-[#52525B]">BEAT GRID</span>
        <span className="label-tiny truncate max-w-[40%] text-right" style={{ color: "#F87171" }}>
          <span className="text-white/90">{labelTrack(deckBTrack)}</span>
          <span className="opacity-70"> · DECK B</span>
        </span>
      </div>
      <div className="relative rounded overflow-hidden border border-white/10 bg-[#050505]"
           style={{
             background:
               "repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 40px), #050505",
           }}>
        <div ref={containerA} className="h-[28px]" data-testid="stacked-wave-a" />
        <div className="h-px bg-white/10" />
        <div ref={containerB} className="h-[28px]" data-testid="stacked-wave-b" />

        {/* Centered playhead line */}
        <div className="absolute top-0 bottom-0 left-1/2 pointer-events-none z-10"
             style={{
               width: "2px",
               marginLeft: "-1px",
               background: "#fff",
               boxShadow: "0 0 8px rgba(255,255,255,0.9), 0 0 2px #fff",
             }} />
        {/* Triangle markers top/bottom */}
        <div className="absolute top-0 left-1/2 pointer-events-none z-10"
             style={{
               marginLeft: "-5px",
               width: 0, height: 0,
               borderLeft: "5px solid transparent",
               borderRight: "5px solid transparent",
               borderTop: "6px solid #fff",
             }} />
        <div className="absolute bottom-0 left-1/2 pointer-events-none z-10"
             style={{
               marginLeft: "-5px",
               width: 0, height: 0,
               borderLeft: "5px solid transparent",
               borderRight: "5px solid transparent",
               borderBottom: "6px solid #fff",
             }} />
      </div>
    </div>
  );
}
