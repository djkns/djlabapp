import { useEffect, useRef } from "react";
import { useDJStore } from "@/store/djStore";

const SLOT_COLORS = [
  "#FF1F1F", "#FF9500", "#FFE500", "#2ECC71",
  "#00D4FF", "#4C6EF5", "#C264FF", "#FF3BA7",
];

/**
 * Renders vertical hot-cue markers directly inside wavesurfer's scrolling
 * wrapper, so they scroll past the centered playhead in lock-step with the
 * waveform. Uses imperative DOM (not React rendering) because the wrapper is
 * owned by wavesurfer's shadow DOM and isn't a React-rendered tree.
 *
 *   • Click marker  → seek to cue
 *   • Shift+click   → clear cue
 *
 * Self-contained: only subscribes to this deck's hotCues + a duration tick.
 * Re-positions on hotCue change, on wavesurfer 'ready' / 'redraw', and when
 * the audio element's duration becomes known.
 */
export default function HotCueMarkers({ deckId, wsRef, audioElRef, seekTo }) {
  const hotCues = useDJStore((s) => s[deckId].hotCues);
  const clearHotCue = useDJStore((s) => s.clearHotCue);
  const layerRef = useRef(null);

  // Mount the marker-layer once into wavesurfer's wrapper.
  useEffect(() => {
    let cancelled = false;
    let layer = null;
    let attachRetry = null;

    const tryAttach = () => {
      if (cancelled) return;
      const ws = wsRef.current;
      if (!ws || typeof ws.getWrapper !== "function") {
        attachRetry = setTimeout(tryAttach, 200);
        return;
      }
      const wrapper = ws.getWrapper();
      if (!wrapper) {
        attachRetry = setTimeout(tryAttach, 200);
        return;
      }
      layer = document.createElement("div");
      layer.style.position = "absolute";
      layer.style.inset = "0";
      layer.style.pointerEvents = "none";
      layer.style.zIndex = "3";
      wrapper.appendChild(layer);
      layerRef.current = layer;
    };
    tryAttach();

    return () => {
      cancelled = true;
      if (attachRetry) clearTimeout(attachRetry);
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
      layerRef.current = null;
    };
  }, [wsRef]);

  // (Re)render markers whenever hotCues change OR wavesurfer's geometry
  // updates (ready, redraw). Imperative — fast and avoids React fighting
  // wavesurfer's internal layout.
  useEffect(() => {
    let unbindReady = null;
    let unbindRedraw = null;
    let raf = 0;

    const render = () => {
      raf = 0;
      const layer = layerRef.current;
      const ws = wsRef.current;
      const el = audioElRef?.current;
      if (!layer || !ws) return;
      const duration = el?.duration || ws.getDuration?.() || 0;
      // Clear previous markers
      layer.innerHTML = "";
      if (!duration || !isFinite(duration) || duration <= 0) return;

      hotCues.forEach((sec, i) => {
        if (sec == null) return;
        const color = SLOT_COLORS[i] || "#FF1F1F";
        const left = (sec / duration) * 100;
        const stem = document.createElement("div");
        stem.style.cssText = `
          position:absolute;top:0;bottom:0;left:${left}%;
          width:2px;margin-left:-1px;
          background:${color};
          box-shadow:0 0 6px ${color}cc, 0 0 2px ${color};
          pointer-events:auto;cursor:pointer;
          z-index:1;
        `;
        stem.title = `Cue ${i + 1} — ${sec.toFixed(2)}s · click to jump · shift+click to clear`;
        stem.dataset.testid = `deck-${deckId}-marker-${i + 1}`;

        const flag = document.createElement("div");
        flag.textContent = String(i + 1);
        flag.style.cssText = `
          position:absolute;top:0;left:1px;
          padding:1px 4px;
          font:700 9px ui-monospace, "JetBrains Mono", monospace;
          background:${color};color:#000;
          border-radius:0 2px 2px 0;
          line-height:1.1;
          letter-spacing:0.05em;
          pointer-events:none;
        `;
        stem.appendChild(flag);

        stem.addEventListener("click", (e) => {
          if (e.shiftKey) {
            clearHotCue(deckId, i);
          } else {
            seekTo?.(sec);
          }
          e.stopPropagation();
        });
        layer.appendChild(stem);
      });
    };

    const queue = () => { if (!raf) raf = requestAnimationFrame(render); };

    // Initial paint + on every cue change
    queue();

    // Re-paint when wavesurfer reports new geometry
    const ws = wsRef.current;
    if (ws && typeof ws.on === "function") {
      try {
        unbindReady = ws.on("ready", queue);
        unbindRedraw = ws.on("redraw", queue);
      } catch { /* older ws */ }
    }
    // Also re-paint when audio metadata loads (gives us duration)
    const el = audioElRef?.current;
    let metaH = null;
    if (el) {
      metaH = () => queue();
      el.addEventListener("loadedmetadata", metaH);
      el.addEventListener("durationchange", metaH);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (typeof unbindReady === "function") unbindReady();
      if (typeof unbindRedraw === "function") unbindRedraw();
      if (el && metaH) {
        el.removeEventListener("loadedmetadata", metaH);
        el.removeEventListener("durationchange", metaH);
      }
    };
  }, [hotCues, deckId, wsRef, audioElRef, seekTo, clearHotCue]);

  return null;
}
