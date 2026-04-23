import { create } from "zustand";

const defaultDeck = () => ({
  track: null,           // { key, name, artist, url, bpm, source } or null
  loading: false,
  playing: false,
  cuePoint: 0,
  currentTime: 0,
  duration: 0,
  baseBPM: 120,          // detected or user-entered
  tempoRange: 8,         // 8 or 16 percent
  tempoPct: 0,           // -tempoRange..+tempoRange
  volume: 0.85,
  eq: { low: 0, mid: 0, high: 0 },
});

export const useDJStore = create((set, get) => ({
  deckA: defaultDeck(),
  deckB: defaultDeck(),
  crossfader: 0,         // -1 .. 1
  masterVolume: 1.0,
  recording: false,

  setDeck: (id, patch) => set((s) => ({ [id]: { ...s[id], ...patch } })),
  setDeckEQ: (id, band, value) => set((s) => ({
    [id]: { ...s[id], eq: { ...s[id].eq, [band]: value } },
  })),
  setCrossfader: (v) => set({ crossfader: v }),
  setMasterVolume: (v) => set({ masterVolume: v }),
  setRecording: (v) => set({ recording: v }),

  currentBPM: (id) => {
    const d = get()[id];
    if (!d || !d.baseBPM) return 0;
    return d.baseBPM * (1 + d.tempoPct / 100);
  },
}));
