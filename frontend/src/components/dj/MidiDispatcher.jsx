import { useEffect, useRef } from "react";
import { useDJStore } from "@/store/djStore";
import { ccTo01, ccToBipolar, midiSignature } from "@/lib/midi";

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
const CC = 0xB0;

const isButtonControl = (ctrl) =>
  ctrl.endsWith(".play") ||
  ctrl.endsWith(".cue") ||
  ctrl.endsWith(".sync") ||
  ctrl.endsWith(".pfl") ||
  ctrl.includes(".hotcue.") ||
  ctrl === "master.record";

/**
 * Listens for MIDI events globally and dispatches `dj:action` CustomEvents.
 */
export default function MidiDispatcher() {
  const mappings = useDJStore((s) => s.midi.mappings);
  const midiEnabled = useDJStore((s) => s.midi.enabled);

  // Track last value per signature for edge detection on buttons
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
      const lastVal = lastValueRef.current[sig] ?? 0;
      lastValueRef.current[sig] = data2;

      if (isButtonControl(ctrl)) {
        // Rising edge: any transition from 0 -> >0 is a press.
        // Also treat bare NOTE_ON with any non-zero velocity as a press.
        const wasZero = lastVal === 0;
        const nowNonZero = data2 > 0;
        if (nowNonZero && wasZero) {
          window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl } }));
        }
        return;
      }

      // Continuous
      let value;
      if (ctrl === "crossfader" || ctrl.endsWith(".tempo")) {
        value = ccToBipolar(data2);
      } else if (ctrl.includes(".eq.")) {
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
