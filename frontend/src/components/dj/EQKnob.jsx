import { useEffect, useRef, useState } from "react";

/**
 * Rotary EQ knob. -12dB .. +12dB, 0 center.
 * Drag vertically to turn. Double-click to reset.
 */
export default function EQKnob({ value = 0, min = -12, max = 12, onChange, label, testid, color = "#D10A0A", size = 48 }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const startRef = useRef({ y: 0, v: 0 });

  // Sync external (MIDI / store) value changes — but NOT while the user is
  // actively dragging, otherwise we'd overwrite the user's own drag updates
  // and the knob would "bounce" as it fights React's re-render cycle.
  useEffect(() => {
    if (!dragging) setLocalValue(value);
  }, [value, dragging]);

  const display = dragging ? localValue : value;
  const range = max - min;
  // map value -> angle -135..+135
  const angle = ((display - min) / range) * 270 - 135;

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      const dy = startRef.current.y - y; // drag up = increase
      const next = Math.max(min, Math.min(max, startRef.current.v + dy * (range / 140)));
      setLocalValue(next);
      onChange?.(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [dragging, min, max, onChange, range]);

  const startDrag = (e) => {
    const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    startRef.current = { y, v: value };
    setLocalValue(value);
    setDragging(true);
    e.preventDefault();
  };

  const active = Math.abs(display) > 0.2;

  return (
    <div className="flex flex-col items-center gap-1">
      <div
        ref={ref}
        data-testid={testid}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
        onDoubleClick={() => { setLocalValue(0); onChange?.(0); }}
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
