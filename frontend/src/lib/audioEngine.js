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

  const low = ctx.createBiquadFilter();
  low.type = "lowshelf"; low.frequency.value = 120; low.gain.value = 0;

  const mid = ctx.createBiquadFilter();
  mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.7; mid.gain.value = 0;

  const high = ctx.createBiquadFilter();
  high.type = "highshelf"; high.frequency.value = 3500; high.gain.value = 0;

  const preFader = ctx.createGain(); // fixed @ 1.0 — tap for cue send
  preFader.gain.value = 1.0;

  const cueSend = ctx.createGain();
  cueSend.gain.value = 0; // off by default; PFL toggles to 1

  const volume = ctx.createGain();
  volume.gain.value = 0.85;

  const crossfade = ctx.createGain();
  crossfade.gain.value = 1.0;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  // Wire:
  source.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(preFader);

  // Cue send (pre-fader)
  preFader.connect(cueSend);
  cueSend.connect(cueBus);

  // Main path (post-EQ, post-volume)
  preFader.connect(volume);
  volume.connect(analyser);
  volume.connect(crossfade);
  crossfade.connect(masterGain);

  return {
    ctx,
    source,
    low, mid, high,
    preFader,
    cueSend,
    volume,
    crossfade,
    analyser,
    setLow: (db) => { low.gain.value = db; },
    setMid: (db) => { mid.gain.value = db; },
    setHigh: (db) => { high.gain.value = db; },
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
