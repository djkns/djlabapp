/**
 * Thin wrapper around a fully-controlled `<input type="range">`. This was
 * previously a hybrid "uncontrolled + sync-via-effect" component intended to
 * fight thumb-bouncing, but that hybrid pattern caused MORE bouncing because
 * React's imperative sync fought the native drag. The simple controlled
 * pattern is the known-working baseline — kept as a wrapper so the existing
 * call-sites in Mixer.jsx stay tidy.
 */
export default function SmoothSlider({
  value, onChange, min, max, step = "any",
  className, style, testid, orient,
  onDoubleClick, title,
}) {
  return (
    <input
      type="range"
      min={min} max={max} step={step}
      value={value}
      onChange={(e) => onChange?.(+e.target.value)}
      onDoubleClick={onDoubleClick}
      className={className}
      style={style}
      data-testid={testid}
      orient={orient}
      title={title}
    />
  );
}
