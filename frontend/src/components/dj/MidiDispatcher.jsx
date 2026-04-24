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

// #2 DJ curve: power 2.3 gives that weighted, "heavy-bottom" volume feel that
// Serato/Traktor/Rekordbox all use. Applied only to unipolar-level controls
// (volume, hp volume, mic, master). Bipolar (tempo, crossfader, EQ) stay
// linear or their native curve.
const DJ_CURVE = 2.3;
const isLevelControl = (ctrl) =>
  ctrl.endsWith(".volume") || ctrl === "master.volume" || ctrl === "hp.volume" ||
  ctrl === "mic.volume" || ctrl === "hp.mix";

/**
 * Listens for MIDI events globally and dispatches `dj:action` CustomEvents.
 * Adds throttling, smoothing, and DJ-curve shaping on top of the raw filter
 * (CC-only + deadzone) applied in lib/midi.js.
 */
export default function MidiDispatcher() {
  const mappings = useDJStore((s) => s.midi.mappings);
  const midiEnabled = useDJStore((s) => s.midi.enabled);

  // Track last value per signature for edge detection on buttons
  const lastValueRef = useRef({});
  const lastFireRef = useRef({});
  // #2 Smoothing state — one low-pass filter per control id
  const smoothedRef = useRef({});
  // #3 Global 5ms throttle — drops T7's flood of CCs
  const lastMsgTsRef = useRef(0);

  const learningRef = useRef(null);
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

      // #3 GLOBAL 5ms THROTTLE — prevents "MIDI flood" from Hercules T7 etc.
      const now = performance.now();
      if (now - lastMsgTsRef.current < 5) return;
      lastMsgTsRef.current = now;

      const sig = midiSignature(e.detail);
      const ctrl = invMap[sig];
      if (!ctrl) return;

      const { data2 } = e.detail;
      const lastVal = lastValueRef.current[sig] ?? -1;
      lastValueRef.current[sig] = data2;
      lastFireRef.current[sig] = now;

      if (isButtonControl(ctrl)) {
        // Rising edge: 0/idle -> >0 is a press.
        const wasZero = lastVal <= 0;
        if (data2 > 0 && wasZero) {
          window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl } }));
        }
        return;
      }

      if (isJogControl(ctrl)) {
        const delta = data2 - 64;
        if (delta === 0) return;
        window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl, value: delta } }));
        return;
      }

      // Continuous controls — compute raw normalized value first
      let raw;
      if (ctrl === "crossfader" || ctrl.endsWith(".tempo") || ctrl.endsWith(".filter")) {
        raw = ccToBipolar(data2);
      } else if (ctrl.includes(".eq.") || ctrl.endsWith(".trim")) {
        raw = ((data2 - 64) / 64) * 12; // -12..+12 dB
      } else {
        raw = ccTo01(data2);
      }

      // #2 ONE-POLE LOW-PASS SMOOTHING — kills stair-stepping between CC
      // values. alpha=0.25 = ~70% toward target per update = feels
      // "weighted" without lag.
      const prev = smoothedRef.current[ctrl] ?? raw;
      const smooth = prev + (raw - prev) * 0.25;
      smoothedRef.current[ctrl] = smooth;

      // #2 DJ CURVE — pow 2.3 on level faders only (volume, HP, mic, master).
      let value = smooth;
      if (isLevelControl(ctrl) && smooth >= 0) {
        value = Math.pow(smooth, DJ_CURVE);
      }

      window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl, value } }));
    };

    window.addEventListener("djlab:midi", handler);
    return () => window.removeEventListener("djlab:midi", handler);
  }, [mappings, midiEnabled]);

  return null;
}
