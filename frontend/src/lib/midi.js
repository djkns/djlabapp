// Minimal WebMIDI wrapper.
// Dispatches a 'djlab:midi' CustomEvent on window with { status, data1, data2, channel }.

let midiAccess = null;
let activeInput = null;
let activeOutput = null;
const stateListeners = new Set();

export async function requestMidi() {
  if (!navigator.requestMIDIAccess) {
    return { ok: false, error: "WebMIDI not supported in this browser. Try Chrome/Edge." };
  }
  try {
    if (!midiAccess) {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.onstatechange = (e) => {
        stateListeners.forEach((cb) => {
          try { cb(e); } catch { /* noop */ }
        });
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || "MIDI access denied" };
  }
}

export function addStateChangeListener(cb) {
  stateListeners.add(cb);
  return () => stateListeners.delete(cb);
}

export function listMidiInputs() {
  if (!midiAccess) return [];
  return Array.from(midiAccess.inputs.values()).map((i) => ({
    id: i.id,
    name: i.name || i.manufacturer || "Unknown MIDI Device",
    state: i.state,
    connection: i.connection,
  }));
}

function handleMessage(e) {
  const [status, data1, data2] = e.data;
  const channel = status & 0x0F;
  const type = status & 0xF0;
  window.dispatchEvent(new CustomEvent("djlab:midi", {
    detail: { status, type, data1, data2: data2 ?? 0, channel, raw: e.data, ts: performance.now() },
  }));
}

export function setActiveInput(deviceId) {
  if (!midiAccess) return false;
  if (activeInput) {
    activeInput.onmidimessage = null;
    activeInput = null;
  }
  const input = midiAccess.inputs.get(deviceId);
  if (!input) return false;
  input.onmidimessage = handleMessage;
  activeInput = input;
  return true;
}

export function getActiveInputId() { return activeInput?.id || null; }
export function getActiveInputName() { return activeInput?.name || null; }

// ----- MIDI OUTPUT (controller feedback — LED rings, pad colors, etc.) -----

export function listMidiOutputs() {
  if (!midiAccess) return [];
  return Array.from(midiAccess.outputs.values()).map((o) => ({
    id: o.id,
    name: o.name || o.manufacturer || "Unknown MIDI Output",
    state: o.state,
    connection: o.connection,
  }));
}

export function setActiveOutput(deviceId) {
  if (!midiAccess) return false;
  const output = midiAccess.outputs.get(deviceId);
  if (!output) return false;
  activeOutput = output;
  return true;
}

/** Auto-pair: find an output device whose name matches the active input's name. */
export function pairOutputToInput() {
  if (!midiAccess || !activeInput) return false;
  const inName = (activeInput.name || "").toLowerCase();
  const out = Array.from(midiAccess.outputs.values()).find(
    (o) => (o.name || "").toLowerCase() === inName
  );
  if (out) {
    activeOutput = out;
    return true;
  }
  return false;
}

export function getActiveOutputId() { return activeOutput?.id || null; }
export function getActiveOutputName() { return activeOutput?.name || null; }

/** Send a CC (0xB0 | channel) to the active output. channel is 0..15. */
export function sendCC(channel, cc, value) {
  if (!activeOutput) return false;
  try {
    activeOutput.send([0xB0 | (channel & 0x0F), cc & 0x7F, Math.max(0, Math.min(127, value | 0))]);
    return true;
  } catch { return false; }
}

/** Send a Note On (0x90 | ch). */
export function sendNoteOn(channel, note, velocity = 127) {
  if (!activeOutput) return false;
  try {
    activeOutput.send([0x90 | (channel & 0x0F), note & 0x7F, Math.max(0, Math.min(127, velocity | 0))]);
    return true;
  } catch { return false; }
}

/**
 * Produce a stable signature for a MIDI event (for matching mappings).
 * Ignores data2 (value) — we key by type+data1+channel.
 */
export function midiSignature({ type, data1, channel }) {
  return `${type}:${data1}:${channel}`;
}

// Friendly type labels for the monitor UI
export function typeLabel(type) {
  switch (type) {
    case 0x80: return "Note Off";
    case 0x90: return "Note On";
    case 0xA0: return "Poly AT";
    case 0xB0: return "CC";
    case 0xC0: return "Program";
    case 0xD0: return "Channel AT";
    case 0xE0: return "Pitch Bend";
    default:   return `0x${type.toString(16)}`;
  }
}

export function ccTo01(value) { return value / 127; }
export function ccToRange(value, min, max) { return min + (value / 127) * (max - min); }
export function ccToBipolar(value) { return (value - 64) / 63; }
