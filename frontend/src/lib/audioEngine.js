// DJ Lab audio engine — shared AudioContext with two deck chains,
// a master bus, a headphone/cue bus, and a master MediaRecorder.
import { createFXSlot } from "./fxRack";
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
    // Use browser default latency. We tried `latencyHint: "interactive"`
    // earlier to get sub-20ms output, but it requested such a small buffer
    // that audio callbacks were starving the main thread and making knobs/
    // faders feel laggy during drag. Default ("balanced") is the sweet spot
    // for a UI-heavy DJ app that drives a hardware controller.
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

  // Element-source mute gain — sits between the <audio> source and the
  // signal chain. We snap this to 0 during scratch mode so only the
  // buffer-slice scratch player is audible. Default 1.0 = unity.
  const elementGain = ctx.createGain();
  elementGain.gain.value = 1.0;

  // Scratch input — buffer-slice player connects HERE during scratch.
  // Joins the chain at the same point as elementGain (post-source, pre-EQ)
  // so scratch audio receives the same EQ/filter/volume/crossfader.
  const scratchInput = ctx.createGain();
  scratchInput.gain.value = 1.0;

  // FX slots (inserted in series after preFader, before cue/volume)
  const fx1 = createFXSlot(ctx);
  const fx2 = createFXSlot(ctx);

  const cueSend = ctx.createGain();
  cueSend.gain.value = 0;

  const volume = ctx.createGain();
  volume.gain.value = 0.85;

  const crossfade = ctx.createGain();
  crossfade.gain.value = 1.0;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;

  // source -> elementGain ┐
  //                       ├-> trim -> EQ -> colorFilter -> preFader -> fx1 -> fx2 -> [cue / volume]
  // scratchInput ─────────┘
  source.connect(elementGain);
  elementGain.connect(trim);
  scratchInput.connect(trim);
  trim.connect(low);
  low.connect(mid);
  mid.connect(high);
  high.connect(colorFilter);
  colorFilter.connect(preFader);
  preFader.connect(fx1.input);
  fx1.output.connect(fx2.input);

  fx2.output.connect(cueSend);
  cueSend.connect(cueBus);

  fx2.output.connect(volume);
  volume.connect(analyser);
  volume.connect(crossfade);
  crossfade.connect(masterGain);

  return {
    ctx, source, trim, low, mid, high, colorFilter, preFader, cueSend, volume, crossfade, analyser,
    fx1, fx2,
    elementGain, scratchInput,
    // All user-controlled gain/freq changes use setTargetAtTime for smooth
    // 10ms ramps — this kills "zipper noise" (audible clicks) that you'd get
    // from writing `.value` directly on every drag pixel. It also decouples
    // the UI event rate from the audio scheduling, so dragging a fader no
    // longer perturbs playback.
    setTrim: (db) => {
      const v = Math.pow(10, db / 20);
      trim.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
    },
    setLow:  (db) => { low.gain.setTargetAtTime(db, ctx.currentTime, 0.02); },
    setMid:  (db) => { mid.gain.setTargetAtTime(db, ctx.currentTime, 0.02); },
    setHigh: (db) => { high.gain.setTargetAtTime(db, ctx.currentTime, 0.02); },
    setFilter: (v) => {
      if (Math.abs(v) < 0.02) {
        colorFilter.type = "allpass";
        colorFilter.frequency.setTargetAtTime(22000, ctx.currentTime, 0.02);
      } else if (v < 0) {
        colorFilter.type = "lowpass";
        colorFilter.frequency.setTargetAtTime(
          22000 * Math.pow(150 / 22000, -v), ctx.currentTime, 0.02);
      } else {
        colorFilter.type = "highpass";
        colorFilter.frequency.setTargetAtTime(
          15 * Math.pow(8000 / 15, v), ctx.currentTime, 0.02);
      }
    },
    setVolume: (v) => { volume.gain.setTargetAtTime(v, ctx.currentTime, 0.01); },
    setCrossfade: (v) => { crossfade.gain.setTargetAtTime(v, ctx.currentTime, 0.01); },
    setCueActive: (on) => { cueSend.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02); },
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

// -------- Scratch Engine (per-deck) ----------------------------------------
//
// Real "wkka wkka" scratching can't be done with HTML5 <audio> alone (every
// seek flushes the decoder = stutter). Instead, we keep the existing audio
// element for NORMAL playback, and switch over to short AudioBufferSource
// slices ONLY while the platter is touched.
//
// Per deck:
//   • scratchBuffers: { fwd: AudioBuffer, rev: AudioBuffer }
//     `rev` is a sample-reversed copy so backward scratch plays in true
//     reverse (vocals etc.) — there's no negative playbackRate in WebAudio.
//   • scratchPos: virtual playhead in seconds, updated every jog tick.
//   • scratchActive: when true, the deck's element gain is muted and the
//     buffer-slice player owns the audible signal.
//
// A "tick" = one jog encoder click. We map ticks → seconds via the same
// SCRATCH_SEC_PER_ROTATION constant the visual layer uses.
//
const scratchState = {};
function getScratchState(deckId) {
  if (!scratchState[deckId]) {
    scratchState[deckId] = {
      buffers: null,
      pos: 0,
      active: false,
      // The element's gain prior to scratch — restored on exit.
      preMuteVol: null,
    };
  }
  return scratchState[deckId];
}

function reverseBuffer(ctx, buf) {
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    const n = src.length;
    for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return out;
}

/**
 * Provide a decoded AudioBuffer for a deck. Call after track load. We
 * pre-build the reversed copy now so each scratch tick is fast.
 *
 * Idempotent — calling again replaces the buffers (e.g. on track change).
 */
export function setScratchBuffer(deckId, audioBuffer) {
  const { ctx } = getAudioContext();
  const s = getScratchState(deckId);
  s.buffers = audioBuffer
    ? { fwd: audioBuffer, rev: reverseBuffer(ctx, audioBuffer) }
    : null;
}

export function clearScratchBuffer(deckId) {
  const s = getScratchState(deckId);
  s.buffers = null;
}

/**
 * Engage scratch mode. Mute the element-driven side of the deck chain so
 * only buffer-slice playback is audible. Caller has already paused the
 * <audio> element.
 *
 * `position` = current track time in seconds (where the platter "lands").
 */
export function enterScratchMode(deckId, position) {
  const s = getScratchState(deckId);
  if (!s.buffers) return false;
  const chain = getDeckChain(deckId);
  if (!chain || !chain.elementGain) return false;
  s.pos = Math.max(0, position || 0);
  s.preMuteVol = chain.elementGain.gain.value;
  // Sharp mute: 5ms is enough to avoid click without smearing the cut.
  const ctx = getAudioContext().ctx;
  chain.elementGain.gain.setTargetAtTime(0, ctx.currentTime, 0.005);
  s.active = true;
  return true;
}

/**
 * Apply a jog tick during scratch. `ticks` is signed — positive = forward.
 * Each call plays a small slice (length proportional to |ticks|) at 1×
 * playbackRate. Multiple slices stacking = the scratch sound.
 *
 * Uses fwd or rev buffer based on direction so backward sounds genuinely
 * reversed (vocals + drums playing backward).
 */
export function scratchTick(deckId, ticks) {
  const s = getScratchState(deckId);
  if (!s.active || !s.buffers || ticks === 0) return;
  const { ctx } = getAudioContext();
  const chain = getDeckChain(deckId);
  if (!chain || !chain.scratchInput) return;

  // Same scale used by the visual jog: 128 ticks = 1.8s of audio.
  const SEC_PER_TICK = 1.8 / 128;
  const dt = ticks * SEC_PER_TICK;
  const dir = dt >= 0 ? 1 : -1;
  const buffer = dir > 0 ? s.buffers.fwd : s.buffers.rev;
  const total = buffer.duration;

  // Compute slice start. For reverse: we play in the reversed buffer
  // starting at (total - pos), so a forward read in rev-buffer maps to a
  // backward read in fwd-buffer.
  let posInBuffer;
  if (dir > 0) {
    posInBuffer = Math.max(0, Math.min(total - 0.05, s.pos));
  } else {
    posInBuffer = Math.max(0, Math.min(total - 0.05, total - s.pos));
  }
  const sliceLen = Math.min(0.06, Math.max(0.01, Math.abs(dt)));

  // Advance our virtual playhead — we're "consuming" `dt` seconds of audio
  // per tick. Clamp to track bounds.
  s.pos = Math.max(0, Math.min(total - 0.05, s.pos + dt));

  // Fire-and-forget source. WebAudio cleans these up automatically.
  try {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // Slight envelope to remove edge clicks on rapid stacking.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    env.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.002);
    env.gain.setValueAtTime(1, ctx.currentTime + sliceLen - 0.002);
    env.gain.linearRampToValueAtTime(0, ctx.currentTime + sliceLen);
    src.connect(env);
    env.connect(chain.scratchInput);
    src.start(ctx.currentTime, posInBuffer, sliceLen);
  } catch { /* noop on edge cases */ }
}

/**
 * Release scratch. Restores element gain so normal HTML5 playback resumes
 * audibly. Returns the final scratch position so the caller can apply it
 * to the audio element's currentTime.
 */
export function exitScratchMode(deckId) {
  const s = getScratchState(deckId);
  if (!s.active) return null;
  const chain = getDeckChain(deckId);
  const ctx = getAudioContext().ctx;
  if (chain?.elementGain && s.preMuteVol != null) {
    chain.elementGain.gain.setTargetAtTime(s.preMuteVol, ctx.currentTime, 0.01);
  }
  s.active = false;
  s.preMuteVol = null;
  return s.pos;
}

export function isScratchActive(deckId) { return !!scratchState[deckId]?.active; }
export function hasScratchBuffer(deckId) { return !!scratchState[deckId]?.buffers; }


// Headphone helpers
let hpMasterEnabled = true;     // T7-style MASTER-to-HP toggle
let hpMixCue = 0.5;             // 0 = master only, 1 = cue only

function applyHpGains() {
  const { ctx, hpCueGain, hpMasterGain } = getAudioContext();
  const cue = hpMixCue;
  const master = hpMasterEnabled ? (1 - hpMixCue) : 0;
  hpCueGain.gain.setTargetAtTime(cue, ctx.currentTime, 0.02);
  hpMasterGain.gain.setTargetAtTime(master, ctx.currentTime, 0.02);
}

export function setHeadphoneMix(value01) {
  // 0 = full master, 1 = full cue
  hpMixCue = Math.max(0, Math.min(1, value01));
  applyHpGains();
}

export function setHeadphoneMasterEnabled(enabled) {
  hpMasterEnabled = !!enabled;
  applyHpGains();
}

export function isHeadphoneMasterEnabled() { return hpMasterEnabled; }

export function setHeadphoneVolume(v) {
  const { ctx, hpGain } = getAudioContext();
  hpGain.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), ctx.currentTime, 0.02);
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
let micAnalyser = null;     // for the mic input VU readout

/** Subscribe to the mic analyser; null when mic is not active. */
export function getMicAnalyser() { return micAnalyser; }

/**
 * DJ-grade mic constraints: disable browser-side processing so the mic feed
 * is dry + low-latency. Echo cancellation, AGC, and noise suppression each
 * add 20-40ms of look-ahead and squash transients (handclaps, plosives) —
 * unwanted in a live DJ context where the user controls levels via the
 * channel strip and broadcasts to a separate audience.
 */
export const DJ_MIC_CONSTRAINTS = {
  echoCancellation: false,
  autoGainControl: false,
  noiseSuppression: false,
};

export async function enableMic(enabled) {
  if (enabled) {
    if (micStream) return true; // already on
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: DJ_MIC_CONSTRAINTS });
      return enableMicWithStream(stream);
    } catch (err) {
      console.error("mic enable failed", err);
      return false;
    }
  } else {
    try { micSource?.disconnect(); } catch { /* ignore */ }
    try { micGain?.disconnect(); } catch { /* ignore */ }
    try { micAnalyser?.disconnect(); } catch { /* ignore */ }
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micStream = null; micSource = null; micGain = null; micAnalyser = null;
    return false;
  }
}

/**
 * Use this when the caller obtained the MediaStream via a synchronous
 * getUserMedia() call inside a user gesture (required by Firefox/Safari).
 */
export function enableMicWithStream(stream) {
  const { ctx, masterGain } = getAudioContext();
  try {
    micStream = stream;
    micSource = ctx.createMediaStreamSource(stream);
    micGain = ctx.createGain();
    micGain.gain.value = 0.8;
    // Pre-gain analyser so the user sees their actual MIC INPUT level
    // (independent of the MIC VOL knob position). Useful as a diagnostic:
    // VU moves = mic samples are flowing; VU flat = pump fix didn't help.
    micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 1024;
    micSource.connect(micAnalyser);
    micSource.connect(micGain);
    micGain.connect(masterGain);

    return true;
  } catch (err) {
    console.error("enableMicWithStream failed", err);
    stream.getTracks().forEach((t) => t.stop());
    micStream = null; micSource = null; micGain = null; micAnalyser = null;
    return false;
  }
}

export function setMicVolume(v) {
  if (!micGain) return;
  const ctx = getAudioContext().ctx;
  // Allow up to 3x boost — many built-in laptop mics need significant
  // gain to be usable without OS-level AGC.
  micGain.gain.setTargetAtTime(Math.max(0, Math.min(3.0, v)), ctx.currentTime, 0.02);
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

/** Returns the master bus MediaStream — useful for live streaming (Icecast). */
export function getMasterStream() {
  const { masterStreamDest } = getAudioContext();
  return masterStreamDest.stream;
}

// -------- Mix-export helpers (WebM -> WAV / MP3) --------

/** Decode a WebM/Opus blob into an AudioBuffer using an OfflineAudioContext. */
async function decodeBlobToAudioBuffer(blob) {
  const ab = await blob.arrayBuffer();
  const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
  const buf = await tempCtx.decodeAudioData(ab.slice(0));
  tempCtx.close();
  return buf;
}

/** Encode an AudioBuffer as a 16-bit PCM WAV Blob. */
export async function blobToWavBlob(blob) {
  const audio = await decodeBlobToAudioBuffer(blob);
  const numChan = audio.numberOfChannels;
  const len = audio.length;
  const sampleRate = audio.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numChan * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = len * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); writeStr(8, "WAVE");
  writeStr(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, numChan, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true); view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); writeStr(36, "data"); view.setUint32(40, dataSize, true);

  // Interleave channels
  const channels = [];
  for (let c = 0; c < numChan; c++) channels.push(audio.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numChan; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      off += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Encode an AudioBuffer as MP3 Blob at the given bitrate (default 320 kbps). */
export async function blobToMp3Blob(blob, bitrateKbps = 320, onProgress) {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const audio = await decodeBlobToAudioBuffer(blob);
  const numChan = Math.min(2, audio.numberOfChannels);
  const sampleRate = audio.sampleRate;
  const encoder = new Mp3Encoder(numChan, sampleRate, bitrateKbps);

  const toInt16 = (f32) => {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const s = Math.max(-1, Math.min(1, f32[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return out;
  };

  const leftF = audio.getChannelData(0);
  const rightF = numChan === 2 ? audio.getChannelData(1) : leftF;
  const left = toInt16(leftF);
  const right = toInt16(rightF);

  const blockSize = 1152;
  const mp3Data = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const l = left.subarray(i, i + blockSize);
    const r = right.subarray(i, i + blockSize);
    const buf = numChan === 2 ? encoder.encodeBuffer(l, r) : encoder.encodeBuffer(l);
    if (buf.length > 0) mp3Data.push(buf);
    if (onProgress && i % (blockSize * 50) === 0) onProgress(i / left.length);
  }
  const flush = encoder.flush();
  if (flush.length > 0) mp3Data.push(flush);
  return new Blob(mp3Data, { type: "audio/mpeg" });
}
