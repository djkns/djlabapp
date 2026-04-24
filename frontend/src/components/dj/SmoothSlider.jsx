import { useEffect, useRef, useState } from "react";

/**
 * A range input that stays visually in sync with external (MIDI / store)
 * value changes when idle, but doesn't fight the user's drag. The DOM thumb
 * is updated imperatively — React never re-renders the input during drag.
 *
 * Why this exists:
 *   - Fully controlled range inputs (`value={x}`) cause visible "thumb
 *     bouncing" under rapid drags because React's render may commit an
 *     older value a frame after the user moved the thumb natively.
 *   - Fully uncontrolled inputs (`defaultValue={x}`) don't reflect MIDI /
 *     Sync / external writes at all.
 *   - This hybrid: uncontrolled DOM + imperative sync when !dragging.
 */
export default function SmoothSlider({
  value, onChange, min, max, step = "any",
  className, style, testid, orient,
  onDoubleClick, title,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  // Initial render — set defaultValue once. After mount, we sync imperatively.
  const defaultRef = useRef(value);

  // Keep the DOM thumb in sync with external value changes — but only while
  // the user isn't actively dragging.
  useEffect(() => {
    if (!dragging && inputRef.current && inputRef.current.value !== String(value)) {
      inputRef.current.value = String(value);
    }
  }, [value, dragging]);

  return (
    <input
      ref={inputRef}
      type="range"
      min={min} max={max} step={step}
      defaultValue={defaultRef.current}
      onChange={(e) => onChange?.(+e.target.value)}
      onMouseDown={() => setDragging(true)}
      onMouseUp={() => setDragging(false)}
      onTouchStart={() => setDragging(true)}
      onTouchEnd={() => setDragging(false)}
      onKeyDown={() => setDragging(true)}
      onKeyUp={() => setDragging(false)}
      onDoubleClick={onDoubleClick}
      className={className}
      style={style}
      data-testid={testid}
      orient={orient}
      title={title}
    />
  );
}
