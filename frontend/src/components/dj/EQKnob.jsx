import { useEffect, useRef, useState } from "react";

/**
 * Rotary EQ knob. -12dB .. +12dB, 0 center.
 * Drag vertically to turn. Double-click to reset.
 */
export default function EQKnob({ value = 0, min = -12, max = 12, onChange, label, testid, color = "#D10A0A", size = 48 }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ y: 0, v: 0 });
  // rAF-throttle the onChange callback so we fire at most 60 times/sec. Without
  // this, mousemove can fire 100+ times/sec → 100+ store commits/sec → React
  // reconciler starves the main thread → audio callback misses its slot →
  // the WAV glitches. rAF naturally aligns us to the display refresh and gives
  // the audio buffer enough time to fill.
  const pendingRef = useRef(null);
  const rafRef = useRef(null);

  const range = max - min;
  // map value -> angle -135..+135
  const angle = ((value - min) / range) * 270 - 135;

  useEffect(() => {
    if (!dragging) return;
    const flush = () => {
      rafRef.current = null;
      if (pendingRef.current != null) {
        const v = pendingRef.current;
        pendingRef.current = null;
        onChange?.(v);
      }
    };
    const onMove = (e) => {
      const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      const dy = startRef.current.y - y; // drag up = increase
      const next = Math.max(min, Math.min(max, startRef.current.v + dy * (range / 140)));
      pendingRef.current = next;
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
    };
    const onUp = () => {
      setDragging(false);
      // Final commit in case rAF hasn't flushed yet
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (pendingRef.current != null) {
        const v = pendingRef.current; pendingRef.current = null; onChange?.(v);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [dragging, min, max, onChange, range]);

  const startDrag = (e) => {
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    startRef.current = { y, v: value };
    setDragging(true);
    e.preventDefault();
  };

  const active = Math.abs(value) > 0.2;

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={ref}
        data-testid={testid}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        onDoubleClick={() => onChange?.(0)}
        className="relative rounded-full cursor-pointer select-none transition-shadow"
        style={{
          width: size, height: size,
          background:
            "radial-gradient(circle at 35% 30%, #2a2a2a 0%, #0a0a0a 70%)",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: active
            ? `0 0 14px ${color}aa, inset 0 0 6px rgba(0,0,0,0.6)`
            : "inset 0 0 6px rgba(0,0,0,0.6)",
        }}
      >
        {/* arc indicator */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(from 225deg, ${color} 0deg ${Math.max(0, angle + 135)}deg, transparent ${Math.max(0, angle + 135)}deg 270deg)`,
            WebkitMask: "radial-gradient(circle, transparent 52%, black 53%)",
            mask: "radial-gradient(circle, transparent 52%, black 53%)",
            opacity: 0.9,
          }}
        />
        {/* pointer */}
        <div
          className="absolute top-1/2 left-1/2 origin-left"
          style={{
            width: "40%",
            height: "2px",
            background: "#fff",
            transform: `translateY(-1px) rotate(${angle - 90}deg)`,
          }}
        />
      </div>
      <span className="label-tiny">{label}</span>
    </div>
  );
}
