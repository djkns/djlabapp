import { useEffect, useRef } from "react";
import { useDJStore } from "@/store/djStore";
import { sendCC, getActiveOutputId } from "@/lib/midi";

/**
 * Sends periodic MIDI CC messages to the active output to rotate the physical
 * controller's jog wheel LED ring in sync with playback.
 *
 * The CC number, channel, and ticks-per-rotation are user-configurable in the
 * MIDI panel (store.midi.ledFeedback). Rate = playback position × ticks ÷ 1.8s
 * (33 1/3 RPM = 1 rotation per 1.8s).
 *
 * Sends at ~30fps only when the deck is playing and feedback is enabled, to
 * avoid flooding the controller.
 */
export default function PlatterLEDFeedback() {
  const midi = useDJStore((s) => s.midi);
  const deckA = useDJStore((s) => s.deckA);
  const deckB = useDJStore((s) => s.deckB);
  const rafRef = useRef(null);
  const lastSentRef = useRef({ a: -1, b: -1, ts: 0 });

  useEffect(() => {
    const { enabled } = midi.ledFeedback || {};
    if (!enabled || !getActiveOutputId()) return;

    const tick = () => {
      const now = performance.now();
      const { ticksPerRotation = 36, deckA: cfgA, deckB: cfgB } = midi.ledFeedback;

      const computeStep = (t) => {
        // 33 1/3 RPM → 1 rotation per 1.8s
        const SEC_PER_ROT = 1.8;
        const frac = ((t % SEC_PER_ROT) / SEC_PER_ROT);
        return Math.floor(frac * ticksPerRotation) % ticksPerRotation;
      };

      const aStep = deckA.playing ? computeStep(deckA.currentTime || 0) : null;
      const bStep = deckB.playing ? computeStep(deckB.currentTime || 0) : null;

      // Throttle: 30fps max
      if (now - lastSentRef.current.ts > 33) {
        if (aStep !== null && aStep !== lastSentRef.current.a) {
          // Map step 0..ticksPerRotation-1 → CC value 0..127
          const val = Math.floor((aStep / ticksPerRotation) * 127);
          sendCC(cfgA.channel, cfgA.cc, val);
          lastSentRef.current.a = aStep;
        }
        if (bStep !== null && bStep !== lastSentRef.current.b) {
          const val = Math.floor((bStep / ticksPerRotation) * 127);
          sendCC(cfgB.channel, cfgB.cc, val);
          lastSentRef.current.b = bStep;
        }
        lastSentRef.current.ts = now;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [midi.ledFeedback, deckA.playing, deckA.currentTime, deckB.playing, deckB.currentTime]);

  return null;
}
