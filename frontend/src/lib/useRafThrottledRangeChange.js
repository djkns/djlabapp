import { useEffect, useRef } from "react";

/**
 * Returns an onChange handler for `<input type="range">` that coalesces rapid
 * value changes to at most one per animation frame (~60 Hz). Without this,
 * HTML range inputs can fire the change event 100–200 times per second on a
 * quick drag, which in turn causes a state-update storm and the audio
 * callback can miss its output deadline (audible as clicks / dropouts during
 * fader moves).
 *
 * The final value on mouseup/touchend is always flushed.
 */
export default function useRafThrottledRangeChange(onCommit) {
  const pendingRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const flush = () => {
    rafRef.current = null;
    if (pendingRef.current != null) {
      const v = pendingRef.current;
      pendingRef.current = null;
      onCommit?.(v);
    }
  };

  return {
    onChange: (e) => {
      pendingRef.current = +e.target.value;
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(flush);
    },
    // Call onBlur and onMouseUp/onTouchEnd to ensure final value commits
    onPointerUp: () => {
      if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (pendingRef.current != null) {
        const v = pendingRef.current; pendingRef.current = null; onCommit?.(v);
      }
    },
  };
}
