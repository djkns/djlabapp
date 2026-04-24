import { create } from "zustand";
import { persist } from "zustand/middleware";

const HOT_CUE_COUNT = 8;
const emptyHotCues = () => Array.from({ length: HOT_CUE_COUNT }, () => null);

const defaultDeck = () => ({
  track: null,
  loading: false,
  playing: false,
  cuePoint: 0,
  currentTime: 0,
  duration: 0,
  baseBPM: 120,
  tempoRange: 8,
  tempoPct: 0,
  keylock: false,
  volume: 0.85,
  trim: 0,                                   // dB, ±12
  filter: 0,                                 // -1..1
  eq: { low: 0, mid: 0, high: 0 },
  hotCues: emptyHotCues(),
  loop: { in: null, out: null, enabled: false, beats: null },
  pflOn: false,
  // Per-deck FX slots
  fx1: { effect: "reverb", enabled: false, amount: 0.5, division: "1/4" },
  fx2: { effect: "delay",  enabled: false, amount: 0.5, division: "1/4" },
});

export const useDJStore = create(
  persist(
    (set, get) => ({
      deckA: defaultDeck(),
      deckB: defaultDeck(),
      crossfader: 0,
      masterVolume: 1.0,
      recording: false,

      // Headphones
      hp: {
        enabled: false,
        mix: 0.5,      // 0 = master, 1 = cue
        volume: 0.8,
        sinkId: "default",
      },

      // Mic / talkover
      mic: {
        enabled: false,
        volume: 0.8,
      },

      // MIDI
      midi: {
        enabled: false,
        deviceId: null,
        deviceName: null,
        mappings: {},  // { [controlId]: { status, data1, channel } }
        learning: null,// controlId currently in Learn mode
        // Platter LED output feedback (Hercules T7 style)
        ledFeedback: {
          enabled: false,
          deckA: { cc: 0x30, channel: 0 }, // Default guesses; user can tweak
          deckB: { cc: 0x30, channel: 1 },
          ticksPerRotation: 36,             // Typical jog LED steps per full rev
        },
      },

      setDeck: (id, patch) => set((s) => ({ [id]: { ...s[id], ...patch } })),
      setDeckEQ: (id, band, value) => set((s) => ({
        [id]: { ...s[id], eq: { ...s[id].eq, [band]: value } },
      })),
      setCrossfader: (v) => set({ crossfader: v }),
      setMasterVolume: (v) => set({ masterVolume: v }),
      setRecording: (v) => set({ recording: v }),

      // Hot cues
      setHotCue: (id, slot, seconds) => set((s) => {
        const cues = [...s[id].hotCues];
        cues[slot] = seconds;
        return { [id]: { ...s[id], hotCues: cues } };
      }),
      clearHotCue: (id, slot) => set((s) => {
        const cues = [...s[id].hotCues];
        cues[slot] = null;
        return { [id]: { ...s[id], hotCues: cues } };
      }),

      // Loops
      setLoop: (id, patch) => set((s) => ({ [id]: { ...s[id], loop: { ...s[id].loop, ...patch } } })),
      clearLoop: (id) => set((s) => ({ [id]: { ...s[id], loop: { in: null, out: null, enabled: false, beats: null } } })),

      // FX — slot is "fx1" or "fx2"
      setFX: (id, slot, patch) => set((s) => ({
        [id]: { ...s[id], [slot]: { ...s[id][slot], ...patch } },
      })),

      // Headphones
      setHp: (patch) => set((s) => ({ hp: { ...s.hp, ...patch } })),
      setPfl: (id, on) => set((s) => ({ [id]: { ...s[id], pflOn: on } })),

      // Mic
      setMic: (patch) => set((s) => ({ mic: { ...s.mic, ...patch } })),

      // MIDI
      setMidi: (patch) => set((s) => ({ midi: { ...s.midi, ...patch } })),
      setLedFeedback: (patch) => set((s) => ({
        midi: { ...s.midi, ledFeedback: { ...s.midi.ledFeedback, ...patch } },
      })),
      setLedFeedbackDeck: (deckKey, patch) => set((s) => ({
        midi: {
          ...s.midi,
          ledFeedback: {
            ...s.midi.ledFeedback,
            [deckKey]: { ...s.midi.ledFeedback[deckKey], ...patch },
          },
        },
      })),
      setMidiMapping: (controlId, mapping) => set((s) => ({
        midi: { ...s.midi, mappings: { ...s.midi.mappings, [controlId]: mapping } },
      })),
      clearMidiMapping: (controlId) => set((s) => {
        const m = { ...s.midi.mappings };
        delete m[controlId];
        return { midi: { ...s.midi, mappings: m } };
      }),

      currentBPM: (id) => {
        const d = get()[id];
        if (!d || !d.baseBPM) return 0;
        return d.baseBPM * (1 + d.tempoPct / 100);
      },
    }),
    {
      name: "djlab-store-v2",
      partialize: (s) => ({
        // Only persist user preferences; NOT live state (track, playing, currentTime)
        hp: s.hp,
        midi: { enabled: s.midi.enabled, deviceId: s.midi.deviceId, deviceName: s.midi.deviceName, mappings: s.midi.mappings, ledFeedback: s.midi.ledFeedback },
        deckA: { baseBPM: s.deckA.baseBPM, tempoRange: s.deckA.tempoRange, volume: s.deckA.volume, eq: s.deckA.eq, trim: s.deckA.trim, filter: s.deckA.filter, keylock: s.deckA.keylock },
        deckB: { baseBPM: s.deckB.baseBPM, tempoRange: s.deckB.tempoRange, volume: s.deckB.volume, eq: s.deckB.eq, trim: s.deckB.trim, filter: s.deckB.filter, keylock: s.deckB.keylock },
      }),
      merge: (persisted, current) => ({
        ...current,
        ...persisted,
        deckA: { ...current.deckA, ...(persisted?.deckA || {}) },
        deckB: { ...current.deckB, ...(persisted?.deckB || {}) },
        hp: { ...current.hp, ...(persisted?.hp || {}) },
        midi: { ...current.midi, ...(persisted?.midi || {}) },
      }),
    }
  )
);
