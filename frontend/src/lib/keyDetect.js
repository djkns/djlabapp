/**
 * Musical key detection — Krumhansl-Schmuckler algorithm.
 *
 * Pipeline:
 *   AudioBuffer → mono mixdown → 4096-point FFT frames (Hann window)
 *   → fold magnitude spectrum into 12-bin pitch-class chromagram
 *   → correlate accumulated chroma against major/minor key profiles
 *     for all 12 rotations → pick the highest correlation.
 *
 * Returns: { tonic: "F#", scale: "minor", label: "F#m", camelot: "11A" }
 *          (or null if input is unusable).
 *
 * Runs in ~300-700 ms on a 90s buffer, all on the main thread. The caller
 * already kicks this off after BPM detection completes, so it's safely off
 * the critical path of audio playback.
 */

// Krumhansl-Kessler key profiles (correlation weights per pitch class).
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES   = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Camelot Wheel — DJs use this to spot harmonic-compatible keys.
// Major keys = B side, Minor keys = A side.
const CAMELOT_MAJOR = {
  C: "8B", "C#": "3B", D: "10B", "D#": "5B", E: "12B", F: "7B",
  "F#": "2B", G: "9B", "G#": "4B", A: "11B", "A#": "6B", B: "1B",
};
const CAMELOT_MINOR = {
  C: "5A", "C#": "12A", D: "7A", "D#": "2A", E: "9A", F: "4A",
  "F#": "11A", G: "6A", "G#": "1A", A: "8A", "A#": "3A", B: "10A",
};

// ---- iterative radix-2 FFT (in-place, real input via packed complex) ----
function fft(re, im) {
  const n = re.length;
  // bit-reverse permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] = re[a] + tRe; im[a] = im[a] + tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

// Pearson correlation between two length-12 vectors.
function correlate(a, b) {
  let aMean = 0, bMean = 0;
  for (let i = 0; i < 12; i++) { aMean += a[i]; bMean += b[i]; }
  aMean /= 12; bMean /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    const av = a[i] - aMean, bv = b[i] - bMean;
    num += av * bv; da += av * av; db += bv * bv;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}

/**
 * Detect musical key from an AudioBuffer.
 * @param {AudioBuffer} buffer
 * @param {object} [opts]
 * @param {number} [opts.maxSeconds=90]  - cap analysis window (perf)
 * @returns {{tonic:string, scale:"major"|"minor", label:string, camelot:string} | null}
 */
export function detectKey(buffer, opts = {}) {
  if (!buffer || !buffer.length) return null;
  const maxSeconds = opts.maxSeconds ?? 90;
  const sr = buffer.sampleRate;
  const FFT_SIZE = 4096;

  // Skip the first ~3s (intro silence / fade-ins commonly throw off detection).
  const startSample = Math.min(buffer.length, Math.floor(3 * sr));
  const endSample = Math.min(buffer.length, startSample + Math.floor(maxSeconds * sr));
  const totalSamples = endSample - startSample;
  if (totalSamples < FFT_SIZE * 4) return null; // too short

  // Mono mixdown into a Float32Array of length totalSamples.
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const mono = new Float32Array(totalSamples);
  if (ch1) {
    for (let i = 0; i < totalSamples; i++) {
      mono[i] = (ch0[startSample + i] + ch1[startSample + i]) * 0.5;
    }
  } else {
    for (let i = 0; i < totalSamples; i++) mono[i] = ch0[startSample + i];
  }

  // Pre-compute Hann window
  const win = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }

  // Pre-compute pitch-class index for each FFT bin (skip DC + above ~5kHz).
  // freq(k) = k * sr / N. midi = 69 + 12*log2(f/440). Pitch class = midi mod 12.
  const halfN = FFT_SIZE / 2;
  const pcIdx = new Int8Array(halfN);
  for (let k = 0; k < halfN; k++) {
    const f = (k * sr) / FFT_SIZE;
    if (f < 55 || f > 5000) { pcIdx[k] = -1; continue; } // ignore subbass + sibilance
    const midi = 69 + 12 * Math.log2(f / 440);
    pcIdx[k] = ((Math.round(midi) % 12) + 12) % 12;
  }

  const chroma = new Float32Array(12);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  // Hop size = FFT_SIZE (no overlap) for speed; 90s gives ~970 frames @ 44.1k.
  for (let off = 0; off + FFT_SIZE <= totalSamples; off += FFT_SIZE) {
    // copy + window into re; zero im
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = mono[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < halfN; k++) {
      const pc = pcIdx[k];
      if (pc < 0) continue;
      // magnitude squared (faster than sqrt; correlation is shape-invariant to scale)
      chroma[pc] += re[k] * re[k] + im[k] * im[k];
    }
  }

  // Normalize chroma
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum === 0) return null;
  for (let i = 0; i < 12; i++) chroma[i] /= sum;

  // Correlate against rotated major/minor profiles
  let best = { score: -Infinity, tonic: 0, scale: "major" };
  const rotated = new Float32Array(12);
  for (let r = 0; r < 12; r++) {
    for (let i = 0; i < 12; i++) rotated[i] = chroma[(i + r) % 12];
    const sMajor = correlate(rotated, MAJOR_PROFILE);
    if (sMajor > best.score) best = { score: sMajor, tonic: r, scale: "major" };
    const sMinor = correlate(rotated, MINOR_PROFILE);
    if (sMinor > best.score) best = { score: sMinor, tonic: r, scale: "minor" };
  }

  const tonicName = NOTE_NAMES[best.tonic];
  const label = best.scale === "major" ? tonicName : tonicName + "m";
  const camelot = best.scale === "major" ? CAMELOT_MAJOR[tonicName] : CAMELOT_MINOR[tonicName];
  return { tonic: tonicName, scale: best.scale, label, camelot };
}

/**
 * Convert a musical-key label like "F#m" or "C" to its Camelot code.
 * Returns null if the label is unparseable.
 */
export function labelToCamelot(label) {
  if (!label) return null;
  const m = /^([A-G]#?)(m?)$/.exec(label.trim());
  if (!m) return null;
  const tonic = m[1];
  const isMinor = m[2] === "m";
  return isMinor ? CAMELOT_MINOR[tonic] : CAMELOT_MAJOR[tonic];
}

/**
 * Compatibility check between two Camelot codes.
 * Returns one of "harmonic" | "energy" | "clash".
 *   harmonic: same code, ±1 around the wheel, OR major↔minor of same number (e.g. 8A ↔ 8B)
 *   energy:  same number, two letters apart isn't possible (only A/B exist) — so this rule
 *            collapses to the relative-major/minor case which we already call "harmonic".
 *            We instead label "energy boost" as +2 along the wheel (e.g. 8A → 10A) which
 *            is a well-known DJ "energy boost" mix.
 *   clash:   anything else.
 */
export function camelotCompat(a, b) {
  if (!a || !b) return null;
  const ma = /^(\d{1,2})([AB])$/.exec(a);
  const mb = /^(\d{1,2})([AB])$/.exec(b);
  if (!ma || !mb) return null;
  const numA = parseInt(ma[1], 10), letA = ma[2];
  const numB = parseInt(mb[1], 10), letB = mb[2];

  // Distance around the 12-position wheel
  const dNum = Math.min(((numA - numB) + 12) % 12, ((numB - numA) + 12) % 12);

  // Same exact key, ±1 same letter, or same number different letter → harmonic
  if (a === b) return "harmonic";
  if (dNum <= 1 && letA === letB) return "harmonic";
  if (dNum === 0 && letA !== letB) return "harmonic";
  // Energy boost = +2 same letter
  if (dNum === 2 && letA === letB) return "energy";
  return "clash";
}
