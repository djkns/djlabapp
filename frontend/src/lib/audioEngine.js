// DJ Lab audio engine — a single shared AudioContext with two deck chains + master recorder.
// Each deck: MediaElementSource -> LowShelf -> Peaking (mid) -> HighShelf -> Volume -> CrossfaderGain -> MasterGain
// Master:   MasterGain -> AudioContext.destination (monitor)
//           MasterGain -> MediaStreamDestination (for MediaRecorder)

let ctx = null;
let masterGain = null;
let masterStreamDest = null;
let masterAnalyser = null;

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
  }
  return { ctx, masterGain, masterStreamDest, masterAnalyser };
}

export async function resumeAudioContext() {
  const { ctx } = getAudioContext();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  return ctx;
}

/**
 * Create an isolated deck chain with EQ + volume + crossfader gain.
 * @param {HTMLAudioElement} audioEl - the <audio> element for this deck
 */
export function createDeckChain(audioEl) {
  const { ctx, masterGain } = getAudioContext();

  // Use MediaElementSource — only allowed once per element!
  const source = ctx.createMediaElementSource(audioEl);

  const low = ctx.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 120;
  low.gain.value = 0;

  const mid = ctx.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1000;
  mid.Q.value = 0.7;
  mid.gain.value = 0;

  const high = ctx.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 3500;
  high.gain.value = 0;

  const volume = ctx.createGain();
  volume.gain.value = 0.85;

  const crossfade = ctx.createGain();
  crossfade.gain.value = 1.0;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  source.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(volume);
  volume.connect(analyser);
  volume.connect(crossfade);
  crossfade.connect(masterGain);

  return {
    ctx,
    source,
    low,
    mid,
    high,
    volume,
    crossfade,
    analyser,
    setLow: (db) => { low.gain.value = db; },
    setMid: (db) => { mid.gain.value = db; },
    setHigh: (db) => { high.gain.value = db; },
    setVolume: (v) => { volume.gain.value = v; },
    setCrossfade: (v) => { crossfade.gain.value = v; },
  };
}

/**
 * Apply equal-power crossfader curve.
 * @param {number} pos  -1 (full A) .. 0 (center) .. +1 (full B)
 * @returns {{a: number, b: number}}
 */
export function crossfadeGains(pos) {
  // map -1..1 -> 0..1
  const x = (pos + 1) / 2;
  const a = Math.cos(x * Math.PI / 2);
  const b = Math.cos((1 - x) * Math.PI / 2);
  return { a, b };
}

let currentRecorder = null;
let currentChunks = [];

export function startMasterRecording(onStop) {
  const { masterStreamDest } = getAudioContext();
  currentChunks = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(masterStreamDest.stream, { mimeType: mime });
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) currentChunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(currentChunks, { type: mime });
    onStop?.(blob, mime);
    currentRecorder = null;
    currentChunks = [];
  };
  recorder.start(250);
  currentRecorder = recorder;
  return recorder;
}

export function stopMasterRecording() {
  if (currentRecorder && currentRecorder.state !== "inactive") {
    currentRecorder.stop();
  }
}

export function isRecording() {
  return currentRecorder && currentRecorder.state === "recording";
}
