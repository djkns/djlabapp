// Minimal WebMIDI wrapper.
// Dispatches a 'djlab:midi' CustomEvent on window with { status, data1, data2, channel }
// Components (or a learn layer) listen for it.

let midiAccess = null;
let activeInput = null;
let listenerBound = false;

export async function requestMidi() {
  if (!navigator.requestMIDIAccess) {
    return { ok: false, error: "WebMIDI not supported in this browser" };
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || "MIDI access denied" };
  }
}

export function listMidiInputs() {
  if (!midiAccess) return [];
  return Array.from(midiAccess.inputs.values()).map((i) => ({
    id: i.id, name: i.name || i.manufacturer || "Unknown MIDI Device",
  }));
}

function handleMessage(e) {
  const [status, data1, data2] = e.data;
  const channel = status & 0x0F;
  const type = status & 0xF0;
  window.dispatchEvent(new CustomEvent("djlab:midi", {
    detail: { status, type, data1, data2, channel, raw: e.data },
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
  listenerBound = true;
  return true;
}

export function getActiveInputName() {
  return activeInput?.name || null;
}

/**
 * Produce a stable signature for a MIDI event (for matching mappings).
 * Ignores data2 (value) — we key by type+data1+channel.
 */
export function midiSignature({ type, data1, channel }) {
  return `${type}:${data1}:${channel}`;
}

/**
 * Convert a CC value 0..127 to the target control's expected range.
 */
export function ccTo01(value) { return value / 127; }
export function ccToRange(value, min, max) { return min + (value / 127) * (max - min); }
export function ccToBipolar(value) { return (value - 64) / 63; }   // -1..1-ish
