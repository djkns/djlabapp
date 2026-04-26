import { memo, useEffect, useRef, useState } from "react";

/**
 * Rotary EQ knob. Visuals are driven by the controlled `value` prop, but the
 * mouse-drag listener is attached ONCE per drag (not re-attached on every
 * mousemove tick) by routing onChange through a ref. This avoids the
 * cleanup/setup churn that was making knobs lag behind the cursor when the
 * parent passed a fresh inline `onChange` on every render.
 *
 * Drag vertically to turn. Double-click to reset to 0.
 */
function EQKnobImpl({ value = 0, min = -12, max = 12, onChange, label, testid, color = "#D10A0A", size = 48 }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ y: 0, v: 0 });

  // Keep onChange in a ref so the drag effect does NOT depend on it. Parent
  // components routinely pass a fresh arrow each render; without this ref the
  // mousemove listener would be removed and re-added 60+ times per second.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const range = max - min;
  // map value -> angle -135..+135
  const angle = ((value - min) / range) * 270 - 135;

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      const dy = startRef.current.y - y; // drag up = increase
      // Sensitivity: 60px to span the full range. Quick wrist flick spans
      // the full sweep; fine control still works for small movements.
      const next = Math.max(min, Math.min(max, startRef.current.v + dy * (range / 60)));
      onChangeRef.current?.(next);
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
  }, [dragging, min, max, range]);

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

// Memoize so a sibling knob's value-change re-render of the parent strip does
// NOT re-render this knob unless its own props actually changed.
export default memo(EQKnobImpl);
