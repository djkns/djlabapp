import { useEffect, useRef } from "react";
import { useDJStore } from "@/store/djStore";

const SLOT_COLORS = [
  "#FF1F1F", "#FF9500", "#FFE500", "#2ECC71",
  "#00D4FF", "#4C6EF5", "#C264FF", "#FF3BA7",
];

/**
 * Hot-cue markers painted directly into wavesurfer's scrolling wrapper so
 * they scroll past the centered playhead in lock-step with the waveform.
 *
 * Interactions (all stopPropagation to keep waveform scrub from competing):
 *   • Plain click on stem          → seek to cue
 *   • Plain drag on stem           → reposition cue (commits on pointerup)
 *   • Double-click on stem         → delete cue
 *   • Right-click (contextmenu)    → delete cue (power-user fallback)
 *
 * Uses imperative DOM because the wrapper is owned by wavesurfer; React would
 * fight its internal layout. Re-renders markers only on hotCue change or
 * when wavesurfer reports new geometry.
 */
export default function HotCueMarkers({ deckId, wsRef, audioElRef, seekTo }) {
  const hotCues = useDJStore((s) => s[deckId].hotCues);
  const clearHotCue = useDJStore((s) => s.clearHotCue);
  const setHotCue = useDJStore((s) => s.setHotCue);
  const layerRef = useRef(null);
  // Use lowercase letter to match the rest of the deck testids (deck-a-*).
  const letter = deckId === "deckA" ? "a" : "b";

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
      // Layer itself lets clicks through so the scrub handler still works
      // everywhere EXCEPT on the marker stems (each stem sets pointer-events:auto).
      layer.style.pointerEvents = "none";
      layer.style.zIndex = "3";
      layer.dataset.testid = `deck-${letter}-hotcue-layer`;
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
  }, [wsRef, deckId]);

  // (Re)render markers whenever hotCues change OR wavesurfer's geometry
  // updates. Imperative, fast, avoids React fighting wavesurfer's layout.
  useEffect(() => {
    let unbindReady = null;
    let unbindRedraw = null;
    let raf = 0;

    const getDuration = () => {
      const ws = wsRef.current;
      const el = audioElRef?.current;
      return el?.duration || ws?.getDuration?.() || 0;
    };

    const render = () => {
      raf = 0;
      const layer = layerRef.current;
      if (!layer) return;
      const duration = getDuration();
      layer.innerHTML = "";
      if (!duration || !isFinite(duration) || duration <= 0) return;

      hotCues.forEach((sec, i) => {
        if (sec == null) return;
        const color = SLOT_COLORS[i] || "#FF1F1F";
        const leftPct = (sec / duration) * 100;

        // Stem container — invisible 12px-wide hit zone centered on the cue
        // position. Easy to grab; still pointer-events:auto so drag works.
        const stem = document.createElement("div");
        stem.style.cssText = `
          position:absolute;top:0;bottom:0;left:${leftPct}%;
          width:12px;margin-left:-6px;
          background:transparent;
          pointer-events:auto;cursor:grab;
          z-index:1;
          touch-action:none;
        `;
        stem.title = `Cue ${i + 1} — ${sec.toFixed(2)}s\nClick: jump · Drag: move · Double-click: delete`;
        stem.dataset.testid = `deck-${letter}-marker-${i + 1}`;
        stem.dataset.cueSlot = String(i);

        // Visible line — 2px wide, centered inside the 12px hit zone
        const line = document.createElement("div");
        line.style.cssText = `
          position:absolute;top:0;bottom:0;left:50%;
          width:2px;margin-left:-1px;
          background:${color};
          box-shadow:0 0 6px ${color}cc, 0 0 2px ${color};
          pointer-events:none;
        `;
        stem.appendChild(line);

        // Flag (number badge)
        const flag = document.createElement("div");
        flag.style.cssText = `
          position:absolute;top:0;left:50%;margin-left:-1px;
          padding:1px 4px;
          font:700 9px ui-monospace, "JetBrains Mono", monospace;
          background:${color};color:#000;
          border-radius:0 2px 2px 0;
          line-height:1.1;
          letter-spacing:0.05em;
          pointer-events:none;
          white-space:nowrap;
        `;
        flag.textContent = String(i + 1);
        stem.appendChild(flag);

        // Delete via double-click anywhere on the stem
        stem.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          e.preventDefault();
          clearHotCue(deckId, i);
        });

        // Delete via right-click (contextmenu) — power-user fallback
        stem.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          clearHotCue(deckId, i);
        });

        // Click / drag on stem
        //   • Plain click (no movement) → seek to cue
        //   • Plain drag (any movement)  → reposition cue (commit on release)
        //   • Double-click               → delete (handled separately above)
        //   • Right-click                → delete (handled separately above)
        let dragState = null;
        const DRAG_THRESHOLD_PX = 4; // tolerate small jitter so a click doesn't move
        const onPointerDown = (e) => {
          if (e.button === 2) return; // right-click → contextmenu deletes
          // Stop the parent waveform from starting a scrub
          e.stopPropagation();

          const layerEl = layerRef.current;
          const rect = layerEl?.getBoundingClientRect();
          dragState = {
            startX: e.clientX,
            startSec: sec,
            moved: false,
            rect,
            lastSec: sec,
          };
          stem.setPointerCapture?.(e.pointerId);
        };

        const onPointerMove = (e) => {
          if (!dragState) return;
          const dx = e.clientX - dragState.startX;
          if (!dragState.moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;
          if (!dragState.moved) {
            // Cross threshold → enter drag mode
            dragState.moved = true;
            stem.style.cursor = "grabbing";
          }
          if (!dragState.rect) return;
          const dur = getDuration();
          if (!dur) return;
          const xRel = e.clientX - dragState.rect.left;
          const pct = Math.max(0, Math.min(1, xRel / dragState.rect.width));
          const newSec = Math.max(0, Math.min(dur - 0.05, pct * dur));
          dragState.lastSec = newSec;
          // Visual preview without committing every frame
          stem.style.left = `${pct * 100}%`;
        };

        const onPointerUp = (e) => {
          if (!dragState) return;
          const wasDrag = dragState.moved;
          const finalSec = dragState.lastSec;
          const startSec = dragState.startSec;
          stem.releasePointerCapture?.(e.pointerId);
          stem.style.cursor = "grab";
          dragState = null;

          if (wasDrag) {
            // Commit the new position — triggers persistence useEffect in Deck.jsx
            setHotCue(deckId, i, finalSec);
          } else {
            // No drag → treat as a click → seek to cue
            seekTo?.(startSec);
          }
        };

        stem.addEventListener("pointerdown", onPointerDown);
        stem.addEventListener("pointermove", onPointerMove);
        stem.addEventListener("pointerup", onPointerUp);
        stem.addEventListener("pointercancel", onPointerUp);

        layer.appendChild(stem);
      });
    };

    const queue = () => { if (!raf) raf = requestAnimationFrame(render); };

    queue();

    const ws = wsRef.current;
    if (ws && typeof ws.on === "function") {
      try {
        unbindReady = ws.on("ready", queue);
        unbindRedraw = ws.on("redraw", queue);
      } catch { /* older ws */ }
    }
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
  }, [hotCues, deckId, wsRef, audioElRef, seekTo, clearHotCue, setHotCue]);

  return null;
}
