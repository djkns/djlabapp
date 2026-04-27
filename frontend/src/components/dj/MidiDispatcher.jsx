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
  ctrl.endsWith(".platterTouch") ||
  ctrl.includes(".hotcue.") ||
  ctrl === "master.record" ||
  ctrl === "mic.enabled";

const isJogControl = (ctrl) => ctrl.endsWith(".jog");

/**
 * Listens for MIDI events globally and dispatches `dj:action` CustomEvents.
 *
 * Continuous controls (knobs, faders) are coalesced to one update per
 * animation frame (~60Hz). The very latest value always wins — no smoothing,
 * no curve, no deadzone. This is purely a "don't queue up more state updates
 * than the browser can paint" guard. Critical for high-traffic faders like
 * the Hercules T7 tempo, which can fire 200+ CC messages per second and
 * otherwise creates a backlog where the slider keeps moving after the
 * physical fader has stopped.
 *
 * Buttons and jog ticks are NOT coalesced — they fire instantly so taps and
 * scratch ticks aren't lost.
 */
export default function MidiDispatcher() {
  const mappings = useDJStore((s) => s.midi.mappings);
  const midiEnabled = useDJStore((s) => s.midi.enabled);

  const lastValueRef = useRef({});      // for button rising-edge
  const pendingRef = useRef(new Map()); // ctrlId -> latest value awaiting next frame
  const rafRef = useRef(0);
  const learningRef = useRef(null);

  const learning = useDJStore((s) => s.midi.learning);
  useEffect(() => { learningRef.current = learning; }, [learning]);

  useEffect(() => {
    if (!midiEnabled) return;

    const invMap = {};
    Object.entries(mappings).forEach(([ctrl, m]) => { invMap[m.signature] = ctrl; });

    const flush = () => {
      rafRef.current = 0;
      const pending = pendingRef.current;
      if (!pending.size) return;
      // Snapshot + clear before dispatching so a re-entrant store update
      // can't lose values.
      const updates = Array.from(pending.entries());
      pending.clear();
      for (const [ctrl, value] of updates) {
        window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl, value } }));
      }
    };

    const queueContinuous = (ctrl, value) => {
      pendingRef.current.set(ctrl, value);
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flush);
    };

    const handler = (e) => {
      if (learningRef.current) return;

      const sig = midiSignature(e.detail);
      const ctrl = invMap[sig];
      if (!ctrl) return;

      const { data2 } = e.detail;
      const lastVal = lastValueRef.current[sig] ?? -1;
      lastValueRef.current[sig] = data2;

      if (isButtonControl(ctrl)) {
        // Platter-touch is a special case: we need BOTH press (data2 > 0)
        // and release (data2 == 0) so the engine knows when to switch
        // back from scratch → pitch-bend mode. Forward both edges with a
        // `pressed` flag.
        if (ctrl.endsWith(".platterTouch")) {
          const pressed = data2 > 0;
          const wasPressed = lastVal > 0;
          if (pressed !== wasPressed) {
            window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl, pressed } }));
          }
          return;
        }
        const wasZero = lastVal <= 0;
        if (data2 > 0 && wasZero) {
          window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl } }));
        }
        return;
      }

      if (isJogControl(ctrl)) {
        // Two encodings supported:
        //
        //  1. CC (`type === 0xB0`, status 176): relative offset-64 — value
        //     64 idle, >64 forward, <64 backward. Most controllers.
        //
        //  2. Pitch Bend (`type === 0xE0`, status 224): high-precision
        //     14-bit, used by Hercules T7 (and some others). The full
        //     value is `(data2 << 7) | data1`, ranging 0..16383 with
        //     8192 as center. We convert to a small signed delta of
        //     ticks per message — empirically T7 emits ~1 message per
        //     1/128th rotation tick, so `(value - 8192) / 64` gives a
        //     delta on the same scale as the CC path.
        const t = e.detail.type;
        let delta;
        if (t === 0xE0) {
          const value14 = (e.detail.data2 << 7) | e.detail.data1;
          delta = Math.round((value14 - 8192) / 64);
        } else {
          delta = data2 - 64;
        }
        if (delta === 0) return;
        window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: ctrl, value: delta } }));
        return;
      }

      // Continuous — coalesce to next animation frame, latest wins.
      let value;
      if (ctrl === "crossfader" || ctrl.endsWith(".tempo") || ctrl.endsWith(".filter")) {
        value = ccToBipolar(data2);
      } else if (ctrl.includes(".eq.") || ctrl.endsWith(".trim")) {
        value = ((data2 - 64) / 64) * 12;
      } else {
        value = ccTo01(data2);
      }
      queueContinuous(ctrl, value);
    };

    window.addEventListener("djlab:midi", handler);
    return () => {
      window.removeEventListener("djlab:midi", handler);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      pendingRef.current.clear();
    };
  }, [mappings, midiEnabled]);

  return null;
}
