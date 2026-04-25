import { useEffect, useRef } from "react";
import { useDJStore } from "@/store/djStore";
import { sendNoteOn, sendCC, getActiveOutputId } from "@/lib/midi";

/**
 * Generic LED feedback service.
 *
 * For every control we have a learned MIDI mapping for, we echo the matching
 * MIDI message back to the controller whenever the underlying app state
 * changes. The Hercules T7 (and most class-compliant DJ controllers) lights
 * the LED next to a button when it receives the same Note On / CC that
 * button sent us.
 *
 * Behavior per control:
 *   • Note On / Note Off mappings → send Note On vel=127 (ON) or vel=0 (OFF).
 *   • CC mappings (rare for buttons) → send CC value=127 (ON) or 0 (OFF).
 *
 * We track the last-sent state per control so we don't spam the wire on
 * unrelated re-renders.
 */
export default function LedFeedback() {
  const lastSentRef = useRef({});

  // Boolean states we mirror to LEDs
  const deckA_playing = useDJStore((s) => s.deckA.playing);
  const deckB_playing = useDJStore((s) => s.deckB.playing);
  const deckA_pfl = useDJStore((s) => s.deckA.pflOn);
  const deckB_pfl = useDJStore((s) => s.deckB.pflOn);
  const deckA_keylock = useDJStore((s) => s.deckA.keylock);
  const deckB_keylock = useDJStore((s) => s.deckB.keylock);
  const deckA_loopOn = useDJStore((s) => s.deckA.loop?.enabled);
  const deckB_loopOn = useDJStore((s) => s.deckB.loop?.enabled);
  const deckA_hotcues = useDJStore((s) => s.deckA.hotCues);
  const deckB_hotcues = useDJStore((s) => s.deckB.hotCues);
  const deckA_fxEnabled = useDJStore((s) => s.deckA.fx1?.enabled);
  const deckB_fxEnabled = useDJStore((s) => s.deckB.fx1?.enabled);
  const hp_enabled = useDJStore((s) => s.hp.enabled);
  const hp_masterEnabled = useDJStore((s) => s.hp.masterEnabled);
  const mic_enabled = useDJStore((s) => s.mic.enabled);
  const mappings = useDJStore((s) => s.midi.mappings);
  const ledFeedbackEnabled = useDJStore((s) => s.midi.ledFeedback?.enabled);

  useEffect(() => {
    if (!ledFeedbackEnabled || !getActiveOutputId()) return;

    const send = (controlId, on) => {
      const mapping = mappings[controlId];
      if (!mapping) return;
      const last = lastSentRef.current[controlId];
      if (last === on) return; // unchanged → skip
      lastSentRef.current[controlId] = on;
      const value = on ? 127 : 0;
      const ch = mapping.channel ?? 0;
      const note = mapping.data1;
      // type bytes: 0x90 = Note On, 0x80 = Note Off, 0xB0 = CC
      const type = mapping.type ?? mapping.status & 0xF0;
      if (type === 0xB0) {
        sendCC(ch, note, value);
      } else {
        sendNoteOn(ch, note, value);
      }
    };

    // Transport
    send("deckA.play", deckA_playing);
    send("deckB.play", deckB_playing);
    // Headphone cue (PFL) per deck
    send("deckA.pfl", deckA_pfl);
    send("deckB.pfl", deckB_pfl);
    // Master headphone toggle
    send("hp.master", hp_masterEnabled);
    // HP enable button on the controller (if mapped)
    send("hp.enabled", hp_enabled);
    // Mic
    send("mic.enabled", mic_enabled);
    // Keylock
    send("deckA.keylock", deckA_keylock);
    send("deckB.keylock", deckB_keylock);
    // Loop active
    send("deckA.loop", deckA_loopOn);
    send("deckB.loop", deckB_loopOn);
    // FX
    send("deckA.fx1.enabled", deckA_fxEnabled);
    send("deckB.fx1.enabled", deckB_fxEnabled);
    // Hot cues (LED on when slot is set / has a stored time)
    if (Array.isArray(deckA_hotcues)) {
      for (let i = 0; i < 8; i++) send(`deckA.hotcue.${i + 1}`, deckA_hotcues[i] != null);
    }
    if (Array.isArray(deckB_hotcues)) {
      for (let i = 0; i < 8; i++) send(`deckB.hotcue.${i + 1}`, deckB_hotcues[i] != null);
    }
  }, [
    deckA_playing, deckB_playing,
    deckA_pfl, deckB_pfl,
    deckA_keylock, deckB_keylock,
    deckA_loopOn, deckB_loopOn,
    deckA_hotcues, deckB_hotcues,
    deckA_fxEnabled, deckB_fxEnabled,
    hp_enabled, hp_masterEnabled, mic_enabled,
    mappings, ledFeedbackEnabled,
  ]);

  // When the user disables LED feedback or output changes, blast all-off
  // so the controller doesn't get stuck with stale lights.
  useEffect(() => {
    if (ledFeedbackEnabled) return;
    const sent = lastSentRef.current;
    Object.keys(sent).forEach((controlId) => {
      if (sent[controlId]) {
        const m = mappings[controlId];
        if (!m) return;
        const ch = m.channel ?? 0;
        const note = m.data1;
        const type = m.type ?? m.status & 0xF0;
        if (type === 0xB0) sendCC(ch, note, 0); else sendNoteOn(ch, note, 0);
        sent[controlId] = false;
      }
    });
  }, [ledFeedbackEnabled, mappings]);

  return null;
}
