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
  ctrl === "master.record" ||
  ctrl === "mic.enabled";

const isJogControl = (ctrl) => ctrl.endsWith(".jog");

/**
 * Listens for MIDI events globally and dispatches `dj:action` CustomEvents.
 */
export default function MidiDispatcher() {
  const mappings = useDJStore((s) => s.midi.mappings);
  const midiEnabled = useDJStore((s) => s.midi.enabled);

  // Track last value per signature for edge detection on buttons
  const lastValueRef = useRef({});
  const lastFireRef = useRef({});
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
      // Drop noise: if the value hasn't changed and last fire was <30ms ago, skip
      const lastFireTs = lastFireRef.current[sig] ?? 0;
      const now = performance.now();
      if (data2 === lastVal && now - lastFireTs < 30) return;
      lastValueRef.current[sig] = data2;
      lastFireRef.current[sig] = now;

      if (isButtonControl(ctrl)) {
        // Rising edge: any transition from 0/idle -> >0 is a press.
        // Treat first-ever message (lastVal === -1) AS rising-edge if non-zero.
        const wasZero = lastVal <= 0;
        const nowNonZero = data2 > 0;
        if (nowNonZero && wasZero) {
          window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl } }));
        }
        return;
      }

      if (isJogControl(ctrl)) {
        // Relative jog encoding (offset-64): data2=64 is idle; data2>64 = forward ticks; data2<64 = backward.
        // Works for Hercules, Numark, Reloop, most Traktor-mapped controllers.
        const delta = data2 - 64;
        if (delta === 0) return;
        window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl, value: delta } }));
        return;
      }

      // Continuous
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
