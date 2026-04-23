import { useEffect, useState } from "react";
import { X, Gamepad2, Plug, PlugZap } from "lucide-react";
import { useDJStore } from "@/store/djStore";
import { requestMidi, listMidiInputs, setActiveInput, midiSignature } from "@/lib/midi";

// The list of controls available for MIDI mapping.
// Each is given a control id, human label, and expected target.
export const MIDI_CONTROLS = [
  // Buttons
  { id: "deckA.play",       label: "Deck A · Play / Pause",   kind: "button" },
  { id: "deckB.play",       label: "Deck B · Play / Pause",   kind: "button" },
  { id: "deckA.cue",        label: "Deck A · Cue",             kind: "button" },
  { id: "deckB.cue",        label: "Deck B · Cue",             kind: "button" },
  { id: "deckA.sync",       label: "Deck A · Sync",            kind: "button" },
  { id: "deckB.sync",       label: "Deck B · Sync",            kind: "button" },
  { id: "deckA.pfl",        label: "Deck A · Headphone Cue",   kind: "button" },
  { id: "deckB.pfl",        label: "Deck B · Headphone Cue",   kind: "button" },
  { id: "master.record",    label: "Master · Record",          kind: "button" },
  // Hot cues
  ...[1,2,3,4,5,6,7,8].map(i => ({ id: `deckA.hotcue.${i}`, label: `Deck A · Hot Cue ${i}`, kind: "button" })),
  ...[1,2,3,4,5,6,7,8].map(i => ({ id: `deckB.hotcue.${i}`, label: `Deck B · Hot Cue ${i}`, kind: "button" })),
  // Faders / knobs
  { id: "crossfader",       label: "Crossfader",               kind: "bipolar" },
  { id: "deckA.volume",     label: "Deck A · Volume",          kind: "unipolar" },
  { id: "deckB.volume",     label: "Deck B · Volume",          kind: "unipolar" },
  { id: "deckA.tempo",      label: "Deck A · Tempo",           kind: "bipolar" },
  { id: "deckB.tempo",      label: "Deck B · Tempo",           kind: "bipolar" },
  { id: "deckA.eq.low",     label: "Deck A · EQ Low",          kind: "bipolar12" },
  { id: "deckA.eq.mid",     label: "Deck A · EQ Mid",          kind: "bipolar12" },
  { id: "deckA.eq.high",    label: "Deck A · EQ High",         kind: "bipolar12" },
  { id: "deckB.eq.low",     label: "Deck B · EQ Low",          kind: "bipolar12" },
  { id: "deckB.eq.mid",     label: "Deck B · EQ Mid",          kind: "bipolar12" },
  { id: "deckB.eq.high",    label: "Deck B · EQ High",         kind: "bipolar12" },
  { id: "master.volume",    label: "Master Volume",            kind: "unipolar" },
  { id: "hp.volume",        label: "Headphone Volume",         kind: "unipolar" },
  { id: "hp.mix",           label: "Headphone Mix",            kind: "unipolar" },
];

export default function MidiPanel({ open, onClose }) {
  const midi = useDJStore((s) => s.midi);
  const setMidi = useDJStore((s) => s.setMidi);
  const setMidiMapping = useDJStore((s) => s.setMidiMapping);
  const clearMidiMapping = useDJStore((s) => s.clearMidiMapping);
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const res = await requestMidi();
      if (!res.ok) { setError(res.error); return; }
      const list = listMidiInputs();
      setDevices(list);
      if (midi.deviceId && list.some((d) => d.id === midi.deviceId)) {
        setActiveInput(midi.deviceId);
        setMidi({ enabled: true });
      }
    })();
  }, [open, midi.deviceId, setMidi]);

  // Learn listener
  useEffect(() => {
    if (!midi.learning) return;
    const handler = (e) => {
      const sig = midiSignature(e.detail);
      setMidiMapping(midi.learning, { signature: sig, type: e.detail.type, data1: e.detail.data1, channel: e.detail.channel });
      setMidi({ learning: null });
    };
    window.addEventListener("djlab:midi", handler);
    return () => window.removeEventListener("djlab:midi", handler);
  }, [midi.learning, setMidiMapping, setMidi]);

  const connect = (deviceId) => {
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return;
    setActiveInput(deviceId);
    setMidi({ enabled: true, deviceId: device.id, deviceName: device.name });
  };

  const disconnect = () => {
    setMidi({ enabled: false, deviceId: null, deviceName: null });
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="midi-panel">
      <div className="bg-[#141414] border border-white/10 rounded-lg w-full max-w-2xl p-6 relative shadow-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <button onClick={onClose} className="absolute top-3 right-3 text-[#52525B] hover:text-white">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 mb-1 text-[#FF1F1F]">
          <Gamepad2 className="w-4 h-4" />
          <span className="label-tiny" style={{ color: "#FF1F1F" }}>MIDI Controller</span>
        </div>
        <h2 className="font-display font-black text-2xl tracking-tight mb-4">Controller mappings</h2>

        {error && (
          <div className="mb-4 p-3 rounded border border-[#D10A0A]/40 bg-[#D10A0A]/10 text-sm text-[#FF1F1F]">
            {error}
          </div>
        )}

        <div className="mb-4 flex flex-col gap-2">
          <span className="label-tiny">Device</span>
          <div className="flex items-center gap-2">
            <select
              value={midi.deviceId || ""}
              onChange={(e) => connect(e.target.value)}
              data-testid="midi-device-select"
              className="flex-1 bg-black/60 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#D10A0A]"
            >
              <option value="">-- Select a MIDI input --</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {midi.enabled ? (
              <button onClick={disconnect} className="px-3 py-1.5 rounded border border-white/20 text-[10px] uppercase tracking-wider text-[#A1A1AA] hover:text-white" data-testid="midi-disconnect">
                <Plug className="w-3 h-3 inline mr-1" /> Disconnect
              </button>
            ) : (
              <span className="text-[10px] uppercase tracking-wider text-[#52525B] px-2">
                <PlugZap className="w-3 h-3 inline mr-1" /> Not connected
              </span>
            )}
          </div>
          {devices.length === 0 && !error && (
            <span className="text-xs text-[#52525B]">
              Plug in a DJ controller (USB) and reload. DJ Lab requests MIDI permission only.
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto border-t border-white/10 pt-3">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#141414]">
              <tr className="label-tiny text-left">
                <th className="px-2 py-1">Control</th>
                <th className="px-2 py-1">Mapping</th>
                <th className="px-2 py-1 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {MIDI_CONTROLS.map((c) => {
                const m = midi.mappings[c.id];
                const learning = midi.learning === c.id;
                return (
                  <tr key={c.id} className="border-b border-white/5">
                    <td className="px-2 py-1.5 text-white truncate max-w-[260px]">{c.label}</td>
                    <td className="px-2 py-1.5 font-mono-dj text-[10px] text-[#A1A1AA]">
                      {m ? `${m.signature}` : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => setMidi({ learning: learning ? null : c.id })}
                          data-testid={`midi-learn-${c.id}`}
                          className={`px-2 py-1 rounded text-[9px] tracking-wider uppercase border transition ${
                            learning
                              ? "bg-[#D10A0A] border-[#FF1F1F] text-white animate-pulse"
                              : "border-white/15 text-[#A1A1AA] hover:border-[#FF1F1F] hover:text-[#FF1F1F]"
                          }`}
                        >
                          {learning ? "Listening…" : "Learn"}
                        </button>
                        {m && (
                          <button
                            onClick={() => clearMidiMapping(c.id)}
                            className="px-2 py-1 rounded text-[9px] tracking-wider uppercase border border-white/10 text-[#52525B] hover:text-white"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
