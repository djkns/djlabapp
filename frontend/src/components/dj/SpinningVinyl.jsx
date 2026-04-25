import { memo, useEffect, useRef, useState } from "react";
import { Disc3 } from "lucide-react";

/**
 * Scratchable spinning platter.
 */
function SpinningVinyl({
  spinning,
  label = "NU",
  size = 160,
  cover = null,
  onScratchStart,
  onScratchMove,
  onScratchEnd,
  externalAngle = 0,       // optional extra rotation (radians), e.g. from MIDI jog
}) {
  const ref = useRef(null);
  const stateRef = useRef({ active: false, baseAngle: 0, lastAngle: 0, totalDelta: 0 });
  const [scratchAngle, setScratchAngle] = useState(null); // when set, overrides auto-spin

  const getAngle = (e) => {
    const el = ref.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pt = e.touches?.[0] || e;
    return Math.atan2(pt.clientY - cy, pt.clientX - cx);
  };

  // Unwrap angle deltas so we get continuous rotation (not wrapped at ±π)
  const unwrap = (prev, curr) => {
    let d = curr - prev;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    return d;
  };

  const onDown = (e) => {
    if (!onScratchStart) return;
    e.preventDefault();
    const a = getAngle(e);
    stateRef.current = { active: true, baseAngle: a, lastAngle: a, totalDelta: 0 };
    setScratchAngle(0);
    onScratchStart();
  };

  useEffect(() => {
    const onMove = (e) => {
      const s = stateRef.current;
      if (!s.active) return;
      const a = getAngle(e);
      const step = unwrap(s.lastAngle, a);
      s.lastAngle = a;
      s.totalDelta += step;
      setScratchAngle(s.totalDelta);
      onScratchMove?.(s.totalDelta);
    };
    const onUp = () => {
      const s = stateRef.current;
      if (!s.active) return;
      s.active = false;
      setScratchAngle(null);
      onScratchEnd?.();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [onScratchMove, onScratchEnd]);

  const scratching = scratchAngle != null;
  // While scratching: transform with absolute angle; otherwise let CSS animate.
  // Apply externalAngle (MIDI jog) as an additive nudge when not scratching.
  const transform = scratching
    ? `rotate(${(scratchAngle * 180) / Math.PI}deg)`
    : (externalAngle ? `rotate(${(externalAngle * 180) / Math.PI}deg)` : undefined);
  const spinClass = (spinning && !scratching && !externalAngle) ? "vinyl-spin" : "";

  return (
    <div
      ref={ref}
      data-testid="spinning-vinyl"
      onMouseDown={onDown}
      onTouchStart={onDown}
      className="relative rounded-full border-[6px] border-[#0a0a0a] shadow-2xl flex items-center justify-center overflow-hidden cursor-grab active:cursor-grabbing select-none"
      style={{ width: size, height: size, background: "#050505", touchAction: "none" }}
    >
      {/* Picture-disc background — full album art rotates underneath the
          grooves when a cover is available, giving the deck the look of a
          custom-printed vinyl. The grooves layer + reflection sit on top so
          the cover doesn't compete with the texture. */}
      {cover && (
        <div
          className={`absolute inset-0 rounded-full overflow-hidden ${spinClass}`}
          style={{ transform }}
        >
          <img src={cover} alt="" draggable={false}
               className="w-full h-full object-cover pointer-events-none" />
        </div>
      )}
      {/* grooves layer — rotates with scratch or auto-spin */}
      <div
        className={`absolute inset-0 rounded-full vinyl-grooves ${spinClass}`}
        style={{ transform, opacity: cover ? 0.55 : 1 }}
      />
      {/* reflection overlay */}
      <div className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle at 30% 30%, rgba(255,31,31,0.08) 0%, transparent 40%)",
        }}
      />
      {/* Center label — when cover is set we still keep a small black label
          ring so the spindle pin reads cleanly on busy art. */}
      <div
        className={`relative rounded-full flex items-center justify-center text-white font-display font-black tracking-tight shadow-inner overflow-hidden ${spinClass}`}
        style={{
          width: "32%",
          height: "32%",
          background: cover ? "#000" : "#D10A0A",
          fontSize: size * 0.09,
          transform,
          boxShadow: cover ? "0 0 0 2px rgba(0,0,0,0.6)" : undefined,
        }}
      >
        {cover ? (
          <Disc3 className="w-3 h-3 opacity-80" />
        ) : (
          <>
            <Disc3 className="w-4 h-4 mr-1 opacity-70" />
            {label}
          </>
        )}
      </div>
      {/* Center pin */}
      <div className="absolute w-2 h-2 rounded-full bg-[#FF1F1F] nu-glow-accent pointer-events-none" />
      {/* Scratch indicator */}
      {scratching && (
        <div className="absolute top-1 left-1 text-[9px] tracking-[0.2em] uppercase text-[#FF1F1F] font-bold pointer-events-none">
          SCR
        </div>
      )}
    </div>
  );
}

// Memoize so Deck re-renders on timeupdate don't thrash the CSS animation.
export default memo(SpinningVinyl, (prev, next) =>
  prev.spinning === next.spinning &&
  prev.label === next.label &&
  prev.size === next.size &&
  prev.cover === next.cover &&
  prev.externalAngle === next.externalAngle &&
  prev.onScratchStart === next.onScratchStart &&
  prev.onScratchMove === next.onScratchMove &&
  prev.onScratchEnd === next.onScratchEnd
);
