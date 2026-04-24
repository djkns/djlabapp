/**
 * FX slot — swappable Reverb / Delay / Flanger unit with one dry/wet knob.
 *
 *   input ── dryGain ──┐
 *          └─ effect ─ wetGain ─┤─► output
 *
 * Dry+wet are the only two gain nodes actually routed to the mixer bus.
 * The "amount" knob crossfades equal-power between them (0 = 100% dry,
 * 1 = 100% wet).
 *
 * Tempo sync — Delay and Flanger `time`/`rate` parameters can be driven by
 * a division of the deck's current BPM via `setTempoSync(bpm, division)`.
 */

const EFFECT_TYPES = ["reverb", "delay", "flanger"];

// 1/4, 1/8, 1/16, 1/2, 1/1 → seconds for a given BPM
function beatsToSeconds(bpm, division) {
  const secPerBeat = 60 / (bpm || 120);
  switch (division) {
    case "1/16": return secPerBeat / 4;
    case "1/8":  return secPerBeat / 2;
    case "1/4":  return secPerBeat;
    case "1/2":  return secPerBeat * 2;
    case "1/1":  return secPerBeat * 4;
    default:     return secPerBeat;
  }
}

// Simple algorithmic reverb impulse (no external IR file needed)
function generateReverbIR(ctx, duration = 2.5, decay = 2.0) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export function createFXSlot(ctx) {
  const input  = ctx.createGain();
  const output = ctx.createGain();
  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const effectBus = ctx.createGain();

  dryGain.gain.value = 1.0;
  wetGain.gain.value = 0.0;
  effectBus.gain.value = 1.0;

  input.connect(dryGain).connect(output);
  input.connect(effectBus);

  // ---- REVERB ----
  const reverb = ctx.createConvolver();
  reverb.buffer = generateReverbIR(ctx, 2.8, 2.4);
  const reverbHigh = ctx.createBiquadFilter();
  reverbHigh.type = "lowpass";
  reverbHigh.frequency.value = 8000;

  // ---- DELAY ----
  const delay = ctx.createDelay(4.0);
  delay.delayTime.value = 0.375;
  const delayFeedback = ctx.createGain();
  delayFeedback.gain.value = 0.45;
  const delayLP = ctx.createBiquadFilter();
  delayLP.type = "lowpass";
  delayLP.frequency.value = 6500;
  // delay -> feedback -> delay (self loop)
  delay.connect(delayLP);
  delayLP.connect(delayFeedback);
  delayFeedback.connect(delay);

  // ---- FLANGER ----
  // Flanger: short delay (1-15ms) modulated by an LFO
  const flangerDelay = ctx.createDelay(0.05);
  flangerDelay.delayTime.value = 0.0045;
  const flangerFeedback = ctx.createGain();
  flangerFeedback.gain.value = 0.65;
  flangerDelay.connect(flangerFeedback).connect(flangerDelay);

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.4;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.0035; // sweep 0-7ms
  lfo.connect(lfoDepth);
  lfoDepth.connect(flangerDelay.delayTime);
  lfo.start();

  // ---- ROUTING (effect -> wetGain is connected dynamically by setEffect) ----
  let currentEffect = "reverb";
  let wetSource = null; // the last-wired node going into wetGain

  const connectEffect = (name) => {
    // Disconnect previous wetSource before rewiring
    try { if (wetSource) wetSource.disconnect(wetGain); } catch { /* ignore */ }
    try { effectBus.disconnect(); } catch { /* ignore */ }
    effectBus.connect(ctx.createGain()); // no-op sink reset
    try { effectBus.disconnect(); } catch { /* ignore */ }

    if (name === "reverb") {
      effectBus.connect(reverb);
      reverb.connect(reverbHigh);
      reverbHigh.connect(wetGain);
      wetSource = reverbHigh;
    } else if (name === "delay") {
      effectBus.connect(delay);
      delay.connect(wetGain);
      wetSource = delay;
    } else if (name === "flanger") {
      effectBus.connect(flangerDelay);
      flangerDelay.connect(wetGain);
      wetSource = flangerDelay;
    }
    currentEffect = name;
  };

  wetGain.connect(output);
  connectEffect("reverb");

  // State
  let enabled = false;
  let amount = 0.5;
  let bpm = 120;
  let division = "1/4";

  const applyAmount = () => {
    const wet = enabled ? amount : 0;
    // Equal-power crossfade so there's no volume dip
    const dryLevel = enabled ? Math.cos(wet * Math.PI / 2) : 1.0;
    const wetLevel = Math.sin(wet * Math.PI / 2);
    dryGain.gain.setTargetAtTime(dryLevel, ctx.currentTime, 0.01);
    wetGain.gain.setTargetAtTime(wetLevel, ctx.currentTime, 0.01);
  };

  const applyTempo = () => {
    if (currentEffect === "delay") {
      const t = beatsToSeconds(bpm, division);
      delay.delayTime.setTargetAtTime(Math.min(3.9, t), ctx.currentTime, 0.02);
    } else if (currentEffect === "flanger") {
      // Flanger LFO rate — 1/1 = 1 cycle per bar ish
      const secPerCycle = beatsToSeconds(bpm, division);
      lfo.frequency.setTargetAtTime(1 / Math.max(0.05, secPerCycle), ctx.currentTime, 0.05);
    }
  };

  return {
    input,
    output,
    getEffect: () => currentEffect,
    setEffect: (name) => {
      if (!EFFECT_TYPES.includes(name)) return;
      connectEffect(name);
      applyTempo();
      applyAmount();
    },
    nextEffect: () => {
      const i = EFFECT_TYPES.indexOf(currentEffect);
      const next = EFFECT_TYPES[(i + 1) % EFFECT_TYPES.length];
      connectEffect(next);
      applyTempo();
      applyAmount();
      return next;
    },
    setEnabled: (on) => { enabled = !!on; applyAmount(); },
    isEnabled: () => enabled,
    setAmount: (v) => { amount = Math.max(0, Math.min(1, v)); applyAmount(); },
    getAmount: () => amount,
    setTempoSync: (newBpm, newDivision) => {
      if (newBpm) bpm = newBpm;
      if (newDivision) division = newDivision;
      applyTempo();
    },
  };
}

export const FX_TYPES = EFFECT_TYPES;
export const FX_DIVISIONS = ["1/16", "1/8", "1/4", "1/2", "1/1"];
