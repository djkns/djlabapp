import { useEffect, useRef } from "react";
import { useDJStore } from "@/store/djStore";
import { ccTo01, ccToBipolar, midiSignature } from "@/lib/midi";

const isButtonControl = (ctrl) =>
  ctrl.endsWith(".play") ||
  ctrl.endsWith(".cue") ||
  ctrl.endsWith(".sync") ||
  ctrl.endsWith(".pfl") ||
  ctrl.endsWith(".enabled") ||
  ctrl.endsWith(".next") ||
  ctrl.includes(".hotcue.") ||
  ctrl === "master.record" ||
  ctrl === "mic.enabled";

const isJogControl = (ctrl) => ctrl.endsWith(".jog");

/**
 * Listens for MIDI events globally and dispatches `dj:action` CustomEvents.
 * PURE PASS-THROUGH: no throttling, smoothing, deadzone or curve shaping.
 * What the controller sends is what the on-screen knob/fader sees, 1:1.
 */
export default function MidiDispatcher() {
  const mappings = useDJStore((s) => s.midi.mappings);
  const midiEnabled = useDJStore((s) => s.midi.enabled);

  // Track last value per signature ONLY for button rising-edge detection.
  const lastValueRef = useRef({});
  const learningRef = useRef(null);

  // Keep learningRef in sync with store (without re-binding listener)
  const learning = useDJStore((s) => s.midi.learning);
  useEffect(() => { learningRef.current = learning; }, [learning]);

  useEffect(() => {
    if (!midiEnabled) return;

    // Build inverted map: signature -> controlId
    const invMap = {};
    Object.entries(mappings).forEach(([ctrl, m]) => { invMap[m.signature] = ctrl; });

    const handler = (e) => {
      // While learning, MidiPanel handles the event — dispatcher stays silent
      if (learningRef.current) return;

      const sig = midiSignature(e.detail);
      const ctrl = invMap[sig];
      if (!ctrl) return;

      const { data2 } = e.detail;
      const lastVal = lastValueRef.current[sig] ?? -1;
      lastValueRef.current[sig] = data2;

      if (isButtonControl(ctrl)) {
        // Rising edge: 0/idle -> >0 is a press. Treat first-ever message
        // (lastVal === -1) as rising-edge if non-zero.
        const wasZero = lastVal <= 0;
        if (data2 > 0 && wasZero) {
          window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl } }));
        }
        return;
      }

      if (isJogControl(ctrl)) {
        // Relative jog encoding (offset-64): data2=64 idle; >64 forward; <64 backward.
        const delta = data2 - 64;
        if (delta === 0) return;
        window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl, value: delta } }));
        return;
      }

      // Continuous — straight linear math, no smoothing.
      let value;
      if (ctrl === "crossfader" || ctrl.endsWith(".tempo") || ctrl.endsWith(".filter")) {
        value = ccToBipolar(data2);
      } else if (ctrl.includes(".eq.") || ctrl.endsWith(".trim")) {
        value = ((data2 - 64) / 64) * 12; // -12..+12 dB
      } else {
        value = ccTo01(data2);
      }
      window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl, value } }));
    };

    window.addEventListener("djlab:midi", handler);
    return () => window.removeEventListener("djlab:midi", handler);
  }, [mappings, midiEnabled]);

  return null;
}
