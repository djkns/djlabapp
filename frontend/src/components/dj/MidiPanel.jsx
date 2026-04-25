import { useEffect, useRef, useState } from "react";
import { X, Gamepad2, Plug, PlugZap, Activity, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useDJStore } from "@/store/djStore";
import {
  requestMidi,
  listMidiInputs,
  listMidiOutputs,
  setActiveInput,
  setActiveOutput,
  pairOutputToInput,
  getActiveOutputId,
  midiSignature,
  addStateChangeListener,
  typeLabel,
  getActiveInputId,
} from "@/lib/midi";

// Grouped control list — easier to scan than a flat 41-row table.
export const MIDI_GROUPS = [
  {
    key: "transport",
    label: "Transport",
    controls: [
      { id: "deckA.play",  label: "Deck A · Play / Pause", kind: "button" },
      { id: "deckB.play",  label: "Deck B · Play / Pause", kind: "button" },
      { id: "deckA.cue",   label: "Deck A · Cue",          kind: "button" },
      { id: "deckB.cue",   label: "Deck B · Cue",          kind: "button" },
      { id: "deckA.sync",  label: "Deck A · Sync",         kind: "button" },
      { id: "deckB.sync",  label: "Deck B · Sync",         kind: "button" },
      { id: "deckA.pfl",   label: "Deck A · Headphone Cue",kind: "button" },
      { id: "deckB.pfl",   label: "Deck B · Headphone Cue",kind: "button" },
      { id: "master.record", label: "Master · Record",     kind: "button" },
    ],
  },
  {
    key: "jog",
    label: "Jog / Platter",
    controls: [
      { id: "deckA.jog", label: "Deck A · Jog Wheel", kind: "jog" },
      { id: "deckB.jog", label: "Deck B · Jog Wheel", kind: "jog" },
    ],
  },
  {
    key: "hotcuesA",
    label: "Hot Cues · Deck A",
    controls: [1,2,3,4,5,6,7,8].map(i => ({ id: `deckA.hotcue.${i}`, label: `Deck A · Hot Cue ${i}`, kind: "button" })),
  },
  {
    key: "hotcuesB",
    label: "Hot Cues · Deck B",
    controls: [1,2,3,4,5,6,7,8].map(i => ({ id: `deckB.hotcue.${i}`, label: `Deck B · Hot Cue ${i}`, kind: "button" })),
  },
  {
    key: "fxA",
    label: "FX · Deck A",
    controls: [
      { id: "deckA.fx1.enabled", label: "Deck A · FX Toggle",      kind: "button" },
      { id: "deckA.fx1.amount",  label: "Deck A · FX Amount",      kind: "unipolar" },
      { id: "deckA.fx1.next",    label: "Deck A · Next Effect",    kind: "button" },
    ],
  },
  {
    key: "fxB",
    label: "FX · Deck B",
    controls: [
      { id: "deckB.fx1.enabled", label: "Deck B · FX Toggle",      kind: "button" },
      { id: "deckB.fx1.amount",  label: "Deck B · FX Amount",      kind: "unipolar" },
      { id: "deckB.fx1.next",    label: "Deck B · Next Effect",    kind: "button" },
    ],
  },
  {
    key: "mixer",
    label: "Mixer / Crossfader",
    controls: [
      { id: "crossfader",   label: "Crossfader",       kind: "bipolar" },
      { id: "deckA.volume", label: "Deck A · Volume",  kind: "unipolar" },
      { id: "deckB.volume", label: "Deck B · Volume",  kind: "unipolar" },
      { id: "deckA.tempo",  label: "Deck A · Tempo",   kind: "bipolar" },
      { id: "deckB.tempo",  label: "Deck B · Tempo",   kind: "bipolar" },
      { id: "deckA.trim",   label: "Deck A · Gain / Trim",  kind: "bipolar12" },
      { id: "deckB.trim",   label: "Deck B · Gain / Trim",  kind: "bipolar12" },
      { id: "deckA.filter", label: "Deck A · Color Filter", kind: "bipolar" },
      { id: "deckB.filter", label: "Deck B · Color Filter", kind: "bipolar" },
    ],
  },
  {
    key: "eq",
    label: "EQ",
    controls: [
      { id: "deckA.eq.low",  label: "Deck A · EQ Low",  kind: "bipolar12" },
      { id: "deckA.eq.mid",  label: "Deck A · EQ Mid",  kind: "bipolar12" },
      { id: "deckA.eq.high", label: "Deck A · EQ High", kind: "bipolar12" },
      { id: "deckB.eq.low",  label: "Deck B · EQ Low",  kind: "bipolar12" },
      { id: "deckB.eq.mid",  label: "Deck B · EQ Mid",  kind: "bipolar12" },
      { id: "deckB.eq.high", label: "Deck B · EQ High", kind: "bipolar12" },
    ],
  },
  {
    key: "master",
    label: "Master · Headphones · Mic",
    controls: [
      { id: "master.volume",   label: "Master Volume",        kind: "unipolar" },
      { id: "hp.volume",       label: "Headphone Volume",     kind: "unipolar" },
      { id: "hp.mix",          label: "Headphone Mix",        kind: "unipolar" },
      { id: "hp.master",       label: "HP Master · Toggle",   kind: "button" },
      { id: "mic.enabled",     label: "Mic · Toggle",         kind: "button" },
      { id: "mic.volume",      label: "Mic Volume",           kind: "unipolar" },
    ],
  },
];

// Flat list (for external consumers, legacy)
export const MIDI_CONTROLS = MIDI_GROUPS.flatMap((g) => g.controls);

export default function MidiPanel({ open, onClose }) {
  const midi = useDJStore((s) => s.midi);
  const setMidi = useDJStore((s) => s.setMidi);
  const setMidiMapping = useDJStore((s) => s.setMidiMapping);
  const clearMidiMapping = useDJStore((s) => s.clearMidiMapping);
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState(null);
  const [monitor, setMonitor] = useState([]);
  const [lastMatched, setLastMatched] = useState(null);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState({}); // groupKey -> bool
  const monitorRef = useRef([]);

  const mappedCount = Object.keys(midi.mappings).length;
  const totalCount = MIDI_CONTROLS.length;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const res = await requestMidi();
      if (cancelled) return;
      if (!res.ok) { setError(res.error); return; }
      setError(null);
      const list = listMidiInputs();
      setDevices(list);
      if (midi.deviceId && list.some((d) => d.id === midi.deviceId) && getActiveInputId() !== midi.deviceId) {
        setActiveInput(midi.deviceId);
        setMidi({ enabled: true });
        pairOutputToInput();
      }
    })();
    const unsub = addStateChangeListener(() => setDevices(listMidiInputs()));
    return () => { cancelled = true; unsub(); };
  }, [open, midi.deviceId, setMidi]);

  useEffect(() => {
    if (!open) return;
    const h = (e) => {
      const msg = { ...e.detail };
      msg.sig = midiSignature(msg);
      monitorRef.current = [msg, ...monitorRef.current].slice(0, 16);
      setMonitor(monitorRef.current);
      const match = Object.entries(midi.mappings).find(([, m]) => m.signature === msg.sig);
      if (match) setLastMatched({ controlId: match[0], sig: msg.sig, data2: msg.data2, t: msg.ts });
    };
    window.addEventListener("djlab:midi", h);
    return () => window.removeEventListener("djlab:midi", h);
  }, [open, midi.mappings]);

  // Learn: sample messages for 500ms after first hit, pick the signature with
  // the most messages (= the one the user is actively moving). Filters out the
  // controller's idle / LED / status chatter that would otherwise be captured first.
  useEffect(() => {
    if (!midi.learning) return;
    const counts = {};
    const samples = {};
    let firstTs = null;
    let finalizeTimer = null;

    const finalize = () => {
      window.removeEventListener("djlab:midi", handler);
      if (finalizeTimer) clearTimeout(finalizeTimer);
      const entries = Object.entries(counts);
      if (entries.length === 0) {
        setMidi({ learning: null });
        return;
      }
      entries.sort((a, b) => b[1] - a[1]);
      const sig = entries[0][0];
      const detail = samples[sig];
      const collision = Object.entries(midi.mappings).find(
        ([id, m]) => m.signature === sig && id !== midi.learning
      );
      if (collision) {
        clearMidiMapping(collision[0]);
      }
      setMidiMapping(midi.learning, {
        signature: sig,
        type: detail.type,
        data1: detail.data1,
        channel: detail.channel,
      });
      setMidi({ learning: null });
    };

    const handler = (e) => {
      const sig = midiSignature(e.detail);
      counts[sig] = (counts[sig] || 0) + 1;
      samples[sig] = e.detail;
      if (firstTs === null) {
        firstTs = performance.now();
        finalizeTimer = setTimeout(finalize, 500);
      }
    };

    // Bail out after 4s with no input
    const idleTimer = setTimeout(() => {
      if (firstTs === null) {
        window.removeEventListener("djlab:midi", handler);
        setMidi({ learning: null });
      }
    }, 4000);

    window.addEventListener("djlab:midi", handler);
    return () => {
      clearTimeout(idleTimer);
      if (finalizeTimer) clearTimeout(finalizeTimer);
      window.removeEventListener("djlab:midi", handler);
    };
  }, [midi.learning, midi.mappings, setMidiMapping, clearMidiMapping, setMidi]);

  const connect = (deviceId) => {
    if (!deviceId) return;
    const device = devices.find((d) => d.id === deviceId);
    if (!device) return;
    const ok = setActiveInput(deviceId);
    if (ok) {
      setMidi({ enabled: true, deviceId: device.id, deviceName: device.name });
      // Auto-pair a MIDI output with the same name (typical for DJ controllers)
      pairOutputToInput();
    }
  };
  const disconnect = () => {
    setActiveInput("__none__");
    setMidi({ enabled: false, deviceId: null, deviceName: null });
  };

  const toggleGroup = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  const clearAll = () => Object.keys(midi.mappings).forEach((k) => clearMidiMapping(k));

  // LED feedback controls
  const setLedFeedback = useDJStore((s) => s.setLedFeedback);
  const setLedFeedbackDeck = useDJStore((s) => s.setLedFeedbackDeck);
  const [outputs, setOutputs] = useState([]);
  useEffect(() => {
    if (!open) return;
    setOutputs(listMidiOutputs());
  }, [open, devices]);

  if (!open) return null;
  const matchedIsRecent = lastMatched && performance.now() - lastMatched.t < 600;

  const matchesFilter = (c) =>
    !filter || c.label.toLowerCase().includes(filter.toLowerCase()) || c.id.toLowerCase().includes(filter.toLowerCase());

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="midi-panel">
      <div className="bg-[#141414] border border-white/10 rounded-lg w-full max-w-3xl p-6 relative shadow-2xl h-[90vh] flex flex-col">
        <button onClick={onClose} className="absolute top-3 right-3 text-[#52525B] hover:text-white">
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2 mb-1 text-[#FF1F1F]">
              <Gamepad2 className="w-4 h-4" />
              <span className="label-tiny" style={{ color: "#FF1F1F" }}>MIDI Controller</span>
            </div>
            <h2 className="font-display font-black text-2xl tracking-tight">Controller mappings</h2>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-baseline gap-1.5 font-mono-dj">
              <span className="text-2xl font-black text-white">{mappedCount}</span>
              <span className="text-xs text-[#52525B]">/ {totalCount} mapped</span>
            </div>
            <button
              onClick={() => setMidi({ enabled: !midi.enabled })}
              data-testid="midi-panic"
              title={midi.enabled ? "Pause MIDI dispatch (mappings preserved)" : "Resume MIDI dispatch"}
              className={`px-3 py-1 rounded text-[10px] uppercase tracking-[0.2em] font-bold border-2 transition ${
                midi.enabled
                  ? "border-[#FF1F1F] text-[#FF1F1F] hover:bg-[#FF1F1F] hover:text-white"
                  : "border-[#A1A1AA] text-[#A1A1AA] bg-[#52525B]/20 hover:border-white hover:text-white"
              }`}
            >
              {midi.enabled ? "Panic · Disable" : "Resume MIDI"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-3 p-2 rounded border border-[#D10A0A]/40 bg-[#D10A0A]/10 text-xs text-[#FF1F1F]">{error}</div>
        )}

        {/* Device */}
        <div className="mb-3 flex items-center gap-2">
          <select
            value={midi.deviceId || ""}
            onChange={(e) => connect(e.target.value)}
            data-testid="midi-device-select"
            className="flex-1 bg-black/60 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-[#D10A0A]"
          >
            <option value="">-- Select a MIDI input --</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name}{d.state === "disconnected" ? " (offline)" : ""}</option>
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

        {/* Monitor */}
        <div className="mb-3 border border-white/10 rounded p-2 bg-black/40" data-testid="midi-monitor">
          <div className="flex items-center justify-between">
            <span className="label-tiny flex items-center gap-1.5">
              <Activity className="w-3 h-3" /> Live Monitor
            </span>
            {matchedIsRecent ? (
              <span className="text-[10px] font-mono-dj text-[#FF1F1F] flex items-center gap-1 animate-pulse">
                <Check className="w-3 h-3" /> {lastMatched.controlId} · {lastMatched.sig} / {lastMatched.data2}
              </span>
            ) : (
              <span className="text-[10px] font-mono-dj text-[#52525B]">{monitor.length ? "Flowing…" : "Waiting for messages…"}</span>
            )}
          </div>
          {monitor.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] font-mono-dj text-[#A1A1AA] max-h-10 overflow-hidden">
              {monitor.slice(0, 8).map((m, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                  {typeLabel(m.type)}·{m.sig}·{m.data2}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Filter + clear all */}
        <div className="mb-2 flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter controls…"
            className="flex-1 bg-black/60 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#D10A0A]"
          />
          {mappedCount > 0 && (
            <button onClick={clearAll} className="px-2 py-1.5 rounded border border-white/15 text-[10px] uppercase tracking-wider text-[#A1A1AA] hover:text-white" data-testid="midi-clear-all">
              Clear all
            </button>
          )}
        </div>

        {/* Platter LED Feedback (controller OUT) */}
        <div className="mb-2 p-2 rounded border border-[#00D4FF]/30 bg-[#00D4FF]/5" data-testid="led-feedback-panel">
          <div className="flex items-center justify-between mb-1.5">
            <span className="label-tiny" style={{ color: "#00D4FF" }}>
              PLATTER LED FEEDBACK (MIDI OUT)
            </span>
            <button
              data-testid="led-feedback-toggle"
              onClick={() => setLedFeedback({ enabled: !midi.ledFeedback?.enabled })}
              className={`px-2 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold border transition ${
                midi.ledFeedback?.enabled
                  ? "border-[#00D4FF] text-[#00D4FF] bg-[#00D4FF]/10"
                  : "border-white/15 text-[#A1A1AA] hover:text-white"
              }`}
            >
              {midi.ledFeedback?.enabled ? "ON" : "OFF"}
            </button>
          </div>
          <div className="flex items-center gap-2 mb-1.5">
            <select
              data-testid="midi-output-select"
              value={getActiveOutputId() || ""}
              onChange={(e) => setActiveOutput(e.target.value)}
              className="flex-1 bg-black/60 border border-white/10 rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-[#00D4FF]"
            >
              <option value="">-- Select a MIDI output --</option>
              {outputs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}{o.state === "disconnected" ? " (offline)" : ""}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[10px]">
            {["deckA", "deckB"].map((dk) => {
              const cfg = midi.ledFeedback?.[dk] || { cc: 0, channel: 0 };
              return (
                <div key={dk} className="flex items-center gap-1.5 border border-white/5 rounded px-1.5 py-1">
                  <span className="font-bold" style={{ color: "#FF1F1F" }}>
                    {dk === "deckA" ? "A" : "B"}
                  </span>
                  <label className="text-[#A1A1AA] flex items-center gap-1">
                    CC
                    <input
                      type="number" min={0} max={127}
                      value={cfg.cc}
                      onChange={(e) => setLedFeedbackDeck(dk, { cc: Math.max(0, Math.min(127, +e.target.value || 0)) })}
                      data-testid={`led-${dk}-cc`}
                      className="w-12 bg-black/60 border border-white/10 rounded px-1 py-0.5 font-mono-dj text-white text-center focus:outline-none focus:border-[#00D4FF]"
                    />
                  </label>
                  <label className="text-[#A1A1AA] flex items-center gap-1">
                    CH
                    <input
                      type="number" min={1} max={16}
                      value={cfg.channel + 1}
                      onChange={(e) => setLedFeedbackDeck(dk, { channel: Math.max(0, Math.min(15, (+e.target.value || 1) - 1)) })}
                      data-testid={`led-${dk}-ch`}
                      className="w-10 bg-black/60 border border-white/10 rounded px-1 py-0.5 font-mono-dj text-white text-center focus:outline-none focus:border-[#00D4FF]"
                    />
                  </label>
                </div>
              );
            })}
          </div>
          <div className="text-[9px] text-[#52525B] mt-1 italic">
            Tip: Hercules T7 default is CC 0x30 (48) on ch 1 (Deck A) / ch 2 (Deck B). If the LEDs don't move, tweak CC / CH.
          </div>
        </div>

        {/* Grouped mapping list with prominent scrollbar */}
        <div className="flex-1 overflow-y-auto border-t border-white/10 pt-1 midi-scroll">
          {MIDI_GROUPS.map((g) => {
            const visible = g.controls.filter(matchesFilter);
            if (visible.length === 0) return null;
            const groupMapped = visible.filter((c) => midi.mappings[c.id]).length;
            const isCollapsed = collapsed[g.key];
            return (
              <div key={g.key} className="mb-1">
                <button
                  onClick={() => toggleGroup(g.key)}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-white/5 text-left"
                >
                  <span className="flex items-center gap-1.5">
                    {isCollapsed ? <ChevronRight className="w-3 h-3 text-[#A1A1AA]" /> : <ChevronDown className="w-3 h-3 text-[#FF1F1F]" />}
                    <span className="label-tiny" style={{ color: isCollapsed ? "#A1A1AA" : "#FF1F1F" }}>{g.label}</span>
                  </span>
                  <span className="text-[10px] font-mono-dj text-[#52525B]">{groupMapped} / {visible.length}</span>
                </button>
                {!isCollapsed && (
                  <div>
                    {visible.map((c) => {
                      const m = midi.mappings[c.id];
                      const learning = midi.learning === c.id;
                      return (
                        <div key={c.id} className="flex items-center gap-2 px-2 py-1 border-b border-white/[0.04] hover:bg-white/[0.02]">
                          <span className="text-xs text-white truncate flex-1 min-w-0">{c.label}</span>
                          <span className="font-mono-dj text-[10px] text-[#A1A1AA] w-20 text-right shrink-0">
                            {m ? m.signature : "—"}
                          </span>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => setMidi({ learning: learning ? null : c.id })}
                              data-testid={`midi-learn-${c.id}`}
                              className={`px-2 py-0.5 rounded text-[9px] tracking-wider uppercase border transition ${
                                learning
                                  ? "bg-[#D10A0A] border-[#FF1F1F] text-white animate-pulse"
                                  : "border-white/15 text-[#A1A1AA] hover:border-[#FF1F1F] hover:text-[#FF1F1F]"
                              }`}
                            >
                              {learning ? "…" : "Learn"}
                            </button>
                            {m && (
                              <button onClick={() => clearMidiMapping(c.id)} className="px-2 py-0.5 rounded text-[9px] tracking-wider uppercase border border-white/10 text-[#52525B] hover:text-white">
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
