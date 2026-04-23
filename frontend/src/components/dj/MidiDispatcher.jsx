import { useEffect } from "react";
import { useDJStore } from "@/store/djStore";
import { ccTo01, ccToBipolar, midiSignature } from "@/lib/midi";

// Types
const NOTE_ON = 0x90;

/**
 * Listens for MIDI events globally and dispatches `dj:action` CustomEvents
 * that Deck / Mixer components listen to. Kept headless.
 */
export default function MidiDispatcher() {
  const mappings = useDJStore((s) => s.midi.mappings);
  const midiEnabled = useDJStore((s) => s.midi.enabled);
  const learning = useDJStore((s) => s.midi.learning);

  useEffect(() => {
    if (!midiEnabled) return;
    const invMap = {};
    Object.entries(mappings).forEach(([ctrl, m]) => { invMap[m.signature] = ctrl; });

    const handler = (e) => {
      if (learning) return; // while learning, MidiPanel handles it
      const sig = midiSignature(e.detail);
      const ctrl = invMap[sig];
      if (!ctrl) return;
      const { type, data2 } = e.detail;

      // Buttons: fire only on NOTE_ON with non-zero velocity, OR CC full-press
      const isButtonPress = (type === NOTE_ON && data2 > 0) || (type === 0xB0 && data2 > 63);
      const isBipolar = ["crossfader", "deckA.tempo", "deckB.tempo"].includes(ctrl);
      const isBipolar12 = ctrl.includes(".eq.");

      if (ctrl.endsWith(".play") || ctrl.endsWith(".cue") || ctrl.endsWith(".sync") ||
          ctrl.endsWith(".pfl") || ctrl.startsWith("deckA.hotcue") || ctrl.startsWith("deckB.hotcue") ||
          ctrl === "master.record") {
        if (isButtonPress) {
          window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl } }));
        }
        return;
      }

      // Continuous
      let value;
      if (isBipolar) value = ccToBipolar(data2);
      else if (isBipolar12) value = (data2 - 64) / 64 * 12; // -12..+12 dB
      else value = ccTo01(data2);

      window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl, value } }));
    };

    window.addEventListener("djlab:midi", handler);
    return () => window.removeEventListener("djlab:midi", handler);
  }, [mappings, midiEnabled, learning]);

  return null;
}
