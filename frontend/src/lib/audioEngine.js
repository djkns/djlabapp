// DJ Lab audio engine — shared AudioContext with two deck chains,
// a master bus, a headphone/cue bus, and a master MediaRecorder.
//
// Deck chain:
//   MediaElementSource -> LowShelf -> Peaking(mid) -> HighShelf -> volume
//      └─ preFaderTap (GainNode @ 1.0) -> cueSend -> cueBus (headphone)
//      └─ crossfadeGain -> masterGain
//
// Master:
//   masterGain -> masterAnalyser -> AudioContext.destination
//   masterGain -> masterStreamDest (for MediaRecorder)
//
// Headphone / cue bus:
//   cueBus -> headphoneMix(cue)  ─┐
//   masterGain -> headphoneMix(master) ─┴─> headphoneGain
//      headphoneGain -> headphoneStreamDest -> <audio>.srcObject (+ setSinkId for physical routing)

let ctx = null;
let masterGain = null;
let masterStreamDest = null;
let masterAnalyser = null;

let cueBus = null;            // sums all decks' cue sends
let hpCueGain = null;         // cue portion of the headphone mix
let hpMasterGain = null;      // master portion of the headphone mix
let hpGain = null;            // headphone master volume
let hpStreamDest = null;      // to feed the physical headphone <audio>
let hpAudioEl = null;         // the element bound to hpStreamDest
let hpSinkId = "default";

export function getAudioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();

    masterGain = ctx.createGain();
    masterGain.gain.value = 1.0;

    masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 1024;

    masterStreamDest = ctx.createMediaStreamDestination();

    masterGain.connect(masterAnalyser);
    masterAnalyser.connect(ctx.destination);
    masterGain.connect(masterStreamDest);

    // Headphone / cue bus
    cueBus = ctx.createGain();
    cueBus.gain.value = 1.0;

    hpCueGain = ctx.createGain();
    hpCueGain.gain.value = 0.5;

    hpMasterGain = ctx.createGain();
    hpMasterGain.gain.value = 0.5;

    hpGain = ctx.createGain();
    hpGain.gain.value = 0.8;

    cueBus.connect(hpCueGain);
    hpCueGain.connect(hpGain);

    masterGain.connect(hpMasterGain);
    hpMasterGain.connect(hpGain);

    hpStreamDest = ctx.createMediaStreamDestination();
    hpGain.connect(hpStreamDest);

    // Create the hidden headphone <audio> (NOT connected to the main graph;
    // it simply plays the headphone stream into whichever output device you pick)
    hpAudioEl = new Audio();
    hpAudioEl.srcObject = hpStreamDest.stream;
    hpAudioEl.autoplay = false;
    hpAudioEl.muted = true; // starts muted; enabled when user activates headphones
  }
  return { ctx, masterGain, masterStreamDest, masterAnalyser, cueBus, hpCueGain, hpMasterGain, hpGain, hpAudioEl };
}

export async function resumeAudioContext() {
  const { ctx } = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  return ctx;
}

export function createDeckChain(audioEl) {
  const { ctx, masterGain, cueBus } = getAudioContext();

  const source = ctx.createMediaElementSource(audioEl);

  // Trim / Gain (±12dB pre-EQ)
  const trim = ctx.createGain();
  trim.gain.value = 1.0;

  const low = ctx.createBiquadFilter();
  low.type = "lowshelf"; low.frequency.value = 120; low.gain.value = 0;

  const mid = ctx.createBiquadFilter();
  mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.7; mid.gain.value = 0;

  const high = ctx.createBiquadFilter();
  high.type = "highshelf"; high.frequency.value = 3500; high.gain.value = 0;

  // Color filter — single biquad whose type + freq is driven by the filter knob:
  // value < 0 -> lowpass sweep down, value > 0 -> highpass sweep up, 0 = bypass (allpass).
  const colorFilter = ctx.createBiquadFilter();
  colorFilter.type = "allpass";
  colorFilter.frequency.value = 22000;
  colorFilter.Q.value = 0.8;

  const preFader = ctx.createGain();
  preFader.gain.value = 1.0;

  const cueSend = ctx.createGain();
  cueSend.gain.value = 0;

  const volume = ctx.createGain();
  volume.gain.value = 0.85;

  const crossfade = ctx.createGain();
  crossfade.gain.value = 1.0;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  // source -> trim -> EQ -> colorFilter -> preFader -> [cue / volume]
  source.connect(trim);
  trim.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(colorFilter);
  colorFilter.connect(preFader);

  preFader.connect(cueSend);
  cueSend.connect(cueBus);

  preFader.connect(volume);
  volume.connect(analyser);
  volume.connect(crossfade);
  crossfade.connect(masterGain);

  return {
    ctx, source, trim, low, mid, high, colorFilter, preFader, cueSend, volume, crossfade, analyser,
    setTrim: (db) => { trim.gain.value = Math.pow(10, db / 20); },
    setLow:  (db) => { low.gain.value  = db; },
    setMid:  (db) => { mid.gain.value  = db; },
    setHigh: (db) => { high.gain.value = db; },
    setFilter: (v) => {
      // v ∈ [-1, 1]. 0 = bypass.
      if (Math.abs(v) < 0.02) {
        colorFilter.type = "allpass";
        colorFilter.frequency.value = 22000;
      } else if (v < 0) {
        colorFilter.type = "lowpass";
        // sweep from 22000 at v=0 down to 150 at v=-1 (exponential)
        colorFilter.frequency.value = 22000 * Math.pow(150 / 22000, -v);
      } else {
        colorFilter.type = "highpass";
        // sweep from 15 at v=0 up to 8000 at v=1 (exponential)
        colorFilter.frequency.value = 15 * Math.pow(8000 / 15, v);
      }
    },
    setVolume: (v) => { volume.gain.value = v; },
    setCrossfade: (v) => { crossfade.gain.value = v; },
    setCueActive: (on) => { cueSend.gain.value = on ? 1 : 0; },
  };
}

export function crossfadeGains(pos) {
  const x = (pos + 1) / 2;
  const a = Math.cos(x * Math.PI / 2);
  const b = Math.cos((1 - x) * Math.PI / 2);
  return { a, b };
}

// Module-level registry so Mixer can reach deck chains without relying on
// React effect ordering (which caused crossfader to never apply gains).
const deckChains = {};
export function registerDeckChain(deckId, chain) { deckChains[deckId] = chain; }
export function getDeckChain(deckId) { return deckChains[deckId] || null; }
export function getAllDeckChains() { return deckChains; }

// Headphone helpers
export function setHeadphoneMix(value01) {
  // 0 = full master, 1 = full cue
  const { hpCueGain, hpMasterGain } = getAudioContext();
  const clamped = Math.max(0, Math.min(1, value01));
  hpCueGain.gain.value = clamped;
  hpMasterGain.gain.value = 1 - clamped;
}

export function setHeadphoneVolume(v) {
  const { hpGain } = getAudioContext();
  hpGain.gain.value = Math.max(0, Math.min(1.5, v));
}

export async function enableHeadphones(enabled) {
  const { hpAudioEl } = getAudioContext();
  hpAudioEl.muted = !enabled;
  try {
    if (enabled) await hpAudioEl.play();
    else hpAudioEl.pause();
  } catch { /* ignore */ }
}

export async function setHeadphoneSinkId(sinkId) {
  const { hpAudioEl } = getAudioContext();
  if (!hpAudioEl.setSinkId) return false;
  try {
    await hpAudioEl.setSinkId(sinkId);
    hpSinkId = sinkId;
    return true;
  } catch {
    return false;
  }
}

export function getHeadphoneSinkId() { return hpSinkId; }

// -------- Mic / Talkover --------
let micStream = null;
let micSource = null;
let micGain = null;

export async function enableMic(enabled) {
  const { ctx, masterGain } = getAudioContext();
  if (enabled) {
    if (micStream) return true; // already on
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      micSource = ctx.createMediaStreamSource(micStream);
      micGain = ctx.createGain();
      micGain.gain.value = 0.8;
      micSource.connect(micGain);
      micGain.connect(masterGain);
      return true;
    } catch (err) {
      console.error("mic enable failed", err);
      micStream = null; micSource = null; micGain = null;
      return false;
    }
  } else {
    try { micSource?.disconnect(); } catch { /* ignore */ }
    try { micGain?.disconnect(); } catch { /* ignore */ }
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micStream = null; micSource = null; micGain = null;
    return false;
  }
}

export function setMicVolume(v) {
  if (!micGain) return;
  micGain.gain.value = Math.max(0, Math.min(1.5, v));
}

export function isMicActive() { return !!micStream; }

let currentRecorder = null;
let currentChunks = [];
let recordStartedAt = 0;

export function startMasterRecording(onStop) {
  const { masterStreamDest } = getAudioContext();
  currentChunks = [];
  recordStartedAt = performance.now();
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(masterStreamDest.stream, { mimeType: mime });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) currentChunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(currentChunks, { type: mime });
    const durationSec = (performance.now() - recordStartedAt) / 1000;
    onStop?.(blob, mime, durationSec);
    currentRecorder = null;
    currentChunks = [];
  };
  recorder.start(250);
  currentRecorder = recorder;
  return recorder;
}

export function stopMasterRecording() {
  if (currentRecorder && currentRecorder.state !== "inactive") currentRecorder.stop();
}
export function isRecording() { return currentRecorder && currentRecorder.state === "recording"; }
