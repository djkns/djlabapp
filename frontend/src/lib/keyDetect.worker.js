/* eslint-disable no-restricted-globals */
/**
 * Key-detection Web Worker.
 * Mirrors the algorithm in keyDetect.js but runs off the main thread so the
 * 300-700 ms FFT pass doesn't freeze knob/fader interactions when a fresh
 * track is loaded.
 *
 * Message protocol:
 *   in:  { id, channels: [Float32Array, ...], sampleRate, maxSeconds }
 *   out: { id, result: {tonic, scale, label, camelot} | null }
 */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CAMELOT_MAJOR = {
  C: "8B", "C#": "3B", D: "10B", "D#": "5B", E: "12B", F: "7B",
  "F#": "2B", G: "9B", "G#": "4B", A: "11B", "A#": "6B", B: "1B",
};
const CAMELOT_MINOR = {
  C: "5A", "C#": "12A", D: "7A", "D#": "2A", E: "9A", F: "4A",
  "F#": "11A", G: "6A", "G#": "1A", A: "8A", "A#": "3A", B: "10A",
};

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
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

function detectKeyFromChannels(channels, sampleRate, maxSeconds) {
  if (!channels || !channels.length || !channels[0].length) return null;
  const FFT_SIZE = 4096;
  const sr = sampleRate;
  const total = channels[0].length;
  const startSample = Math.min(total, Math.floor(3 * sr));
  const endSample = Math.min(total, startSample + Math.floor((maxSeconds ?? 90) * sr));
  const totalSamples = endSample - startSample;
  if (totalSamples < FFT_SIZE * 4) return null;

  const ch0 = channels[0];
  const ch1 = channels.length > 1 ? channels[1] : null;
  const mono = new Float32Array(totalSamples);
  if (ch1) {
    for (let i = 0; i < totalSamples; i++) {
      mono[i] = (ch0[startSample + i] + ch1[startSample + i]) * 0.5;
    }
  } else {
    for (let i = 0; i < totalSamples; i++) mono[i] = ch0[startSample + i];
  }

  const win = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
  }
  const halfN = FFT_SIZE / 2;
  const pcIdx = new Int8Array(halfN);
  for (let k = 0; k < halfN; k++) {
    const f = (k * sr) / FFT_SIZE;
    if (f < 55 || f > 5000) { pcIdx[k] = -1; continue; }
    const midi = 69 + 12 * Math.log2(f / 440);
    pcIdx[k] = ((Math.round(midi) % 12) + 12) % 12;
  }
  const chroma = new Float32Array(12);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  for (let off = 0; off + FFT_SIZE <= totalSamples; off += FFT_SIZE) {
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = mono[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < halfN; k++) {
      const pc = pcIdx[k];
      if (pc < 0) continue;
      chroma[pc] += re[k] * re[k] + im[k] * im[k];
    }
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += chroma[i];
  if (sum === 0) return null;
  for (let i = 0; i < 12; i++) chroma[i] /= sum;

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

self.onmessage = (e) => {
  const { id, channels, sampleRate, maxSeconds } = e.data || {};
  try {
    const result = detectKeyFromChannels(channels, sampleRate, maxSeconds);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, result: null, error: String(err?.message || err) });
  }
};
