import { useEffect, useRef } from "react";
import { useDJStore } from "@/store/djStore";
import { sendCC, getActiveOutputId } from "@/lib/midi";

/**
 * Sends periodic MIDI CC messages to the active MIDI output to rotate the
 * physical controller's jog-wheel LED ring in sync with playback.
 *
 * PERF NOTE: we read live deck state from `useDJStore.getState()` INSIDE the
 * RAF loop instead of via subscriptions so the effect doesn't tear down and
 * rebuild on every currentTime update. That was causing audio jitter.
 */
export default function PlatterLEDFeedback() {
  const midi = useDJStore((s) => s.midi);
  const rafRef = useRef(null);
  const lastSentRef = useRef({ a: -1, b: -1, ts: 0 });

  useEffect(() => {
    const { enabled } = midi.ledFeedback || {};
    if (!enabled || !getActiveOutputId()) return;

    const tick = () => {
      const now = performance.now();
      const st = useDJStore.getState();
      const { ticksPerRotation = 36, deckA: cfgA, deckB: cfgB } = st.midi.ledFeedback;
      const dA = st.deckA;
      const dB = st.deckB;

      const computeStep = (t) => {
        const SEC_PER_ROT = 1.8;
        const frac = ((t % SEC_PER_ROT) / SEC_PER_ROT);
        return Math.floor(frac * ticksPerRotation) % ticksPerRotation;
      };

      const aStep = dA.playing ? computeStep(dA.currentTime || 0) : null;
      const bStep = dB.playing ? computeStep(dB.currentTime || 0) : null;

      if (now - lastSentRef.current.ts > 33) {
        if (aStep !== null && aStep !== lastSentRef.current.a) {
          sendCC(cfgA.channel, cfgA.cc, Math.floor((aStep / ticksPerRotation) * 127));
          lastSentRef.current.a = aStep;
        }
        if (bStep !== null && bStep !== lastSentRef.current.b) {
          sendCC(cfgB.channel, cfgB.cc, Math.floor((bStep / ticksPerRotation) * 127));
          lastSentRef.current.b = bStep;
        }
        lastSentRef.current.ts = now;
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [midi.ledFeedback]);

  return null;
}
