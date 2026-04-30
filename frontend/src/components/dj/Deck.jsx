import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, SkipBack, Upload, Headphones, Activity } from "lucide-react";
import SpinningVinyl from "./SpinningVinyl";
import EQKnob from "./EQKnob";
import HotCuePad from "./HotCuePad";
import HotCueMarkers from "./HotCueMarkers";
import LoopControls from "./LoopControls";
import FXSlot from "./FXSlot";

import { useDJStore } from "@/store/djStore";
import { useShallow } from "zustand/react/shallow";
import {
  createDeckChain, registerDeckChain, registerDeckAudioEl, getDeckAudioEl, resumeAudioContext, getAudioContext,
  setScratchBuffer, clearScratchBuffer, enterScratchMode, exitScratchMode, scratchTick, hasScratchBuffer,
} from "@/lib/audioEngine";
import { readTags, readTagsFromUrl } from "@/lib/mediaTags";
import { analyze as analyzeBPM, guess as guessBPM } from "web-audio-beat-detector";
import { toast } from "sonner";

const formatTime = (s) => {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

/**
 * Force-paint wavesurfer's canvas from a decoded AudioBuffer.
 *
 * Why: wavesurfer v7's `ws.load(url)` path is unreliable in this app — its
 * "ready" event fires after audio decode but BEFORE canvas paint, leaving
 * the canvas blank. Calling `ws.load(url, peaks, duration)` with peaks we
 * already have paints synchronously and bypasses that race entirely.
 *
 * Preserves the audio element's currentTime + play state across the re-load
 * so a playing track isn't yanked back to t=0.
 */
async function paintWaveformFromBuffer({ ws, audioEl, buf, url, label = "?" }) {
  if (!ws || !buf) return;
  try {
    const peaks = [];
    for (let i = 0; i < buf.numberOfChannels; i++) {
      peaks.push(buf.getChannelData(i));
    }
    const t = audioEl?.currentTime || 0;
    const wasPlaying = audioEl ? !audioEl.paused : false;
    await ws.load(url, peaks, buf.duration).catch((err) => {
      console.warn(`[ws ${label}] peaks-render load failed`, err);
    });
    if (audioEl) {
      try { audioEl.currentTime = t; } catch { /* noop */ }
      if (wasPlaying) audioEl.play().catch(() => {});
    }
  } catch (err) {
    console.warn(`[ws ${label}] peaks-render threw`, err);
  }
}

/**
 * BPM input — holds a draft string so the user can type freely without
 * the per-keystroke clamp snapping characters back. Commits on blur or
 * Enter; reverts on Escape.
 */
function BPMInput({ deckId, letter, baseBPM, setDeck }) {
  const [draft, setDraft] = useState(String(baseBPM));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(baseBPM)); }, [baseBPM, focused]);

  const commit = () => {
    const n = Number(draft);
    if (!isFinite(n) || n <= 0) {
      setDraft(String(baseBPM));
      return;
    }
    const clamped = Math.max(40, Math.min(220, n));
    setDeck(deckId, { baseBPM: clamped });
    setDraft(String(clamped));
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => { setFocused(true); e.target.select(); }}
      onBlur={() => { setFocused(false); commit(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.currentTarget.blur(); }
        else if (e.key === "Escape") { setDraft(String(baseBPM)); e.currentTarget.blur(); }
      }}
      className="bpm-input w-12 bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[10px] font-mono-dj text-white text-center focus:outline-none focus:border-[#D10A0A]"
      data-testid={`deck-${letter}-base-bpm`}
      title="Base BPM (Enter to apply, Esc to cancel)"
    />
  );
}

export default function Deck({ id, label, accent }) {
  const letter = id === "deckA" ? "a" : "b";
  const waveRef = useRef(null);
  const audioElRef = useRef(null);
  const wsRef = useRef(null);
  const chainRef = useRef(null);
  const rafRef = useRef(null);
  const currentTimeRef = useRef(0);

  const deck = useDJStore(useShallow((s) => ({
    track: s[id].track,
    playing: s[id].playing,
    baseBPM: s[id].baseBPM,
    // tempoPct is intentionally NOT here — subscribing Deck to it would re-
    // render the whole deck (vinyl + hot cues + loops + FX + waveform) on
    // every tempo-fader tick. The two tempo readouts and the playbackRate
    // write live in dedicated leaf components below.
    tempoRange: s[id].tempoRange,
    keylock: s[id].keylock,
    pflOn: s[id].pflOn,
    syncedTo: s[id].syncedTo,
    cuePoint: s[id].cuePoint,
    hotCues: s[id].hotCues,
  })));
  // currentTime / duration tick 4×/sec — isolated into a memoized sub-component
  // (DeckTimeReadout) so the full Deck tree (knobs/faders/FX) doesn't reconcile
  // on every playback tick. Same for cross-deck key/BPM compatibility.
  const setDeck = useDJStore((s) => s.setDeck);
  const setLoop = useDJStore((s) => s.setLoop);
  const setDeckEQ = useDJStore((s) => s.setDeckEQ);
  const setHotCue = useDJStore((s) => s.setHotCue);
  const setPfl = useDJStore((s) => s.setPfl);
  const setSyncedTo = useDJStore((s) => s.setSyncedTo);

  const [beatFlash, setBeatFlash] = useState(false);
  const [analyzingBPM, setAnalyzingBPM] = useState(false);
  // Tracks the cuesJson last known to be in the DB for the current track.
  // Lifted up here so `loadTrack` can mark cache-restored cues as
  // already-persisted (preventing a needless POST that would overwrite the
  // same value, and protecting against the load-time all-null reset stomping
  // on the cached cues).
  const cuesAlreadyPersistedRef = useRef({ key: null, json: null });

  // Audio element + chain
  useEffect(() => {
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    audioElRef.current = el;
    registerDeckAudioEl(id, el);

    try {
      chainRef.current = createDeckChain(el);
      registerDeckChain(id, chainRef.current);
      window.dispatchEvent(new CustomEvent("dj:chain-ready", { detail: { deckId: id, chain: chainRef.current, audioEl: el } }));
    } catch (err) { console.error("deck chain error", err); }

    el.addEventListener("ended", () => setDeck(id, { playing: false }));
    el.addEventListener("loadedmetadata", () => setDeck(id, { duration: el.duration || 0 }));
    // Reduced-rate currentTime updates. Browser's `timeupdate` fires 4-8×/sec
    // and caused every store-subscribed component to re-render, blocking the
    // main thread (visible as sticky sliders + audio jitter). Instead we:
    //  1. Keep a ref of the latest currentTime for in-this-file logic.
    //  2. Only write the store every 250ms (4 Hz) for the UI clock display.
    let lastStoreWrite = 0;
    el.addEventListener("timeupdate", () => {
      const t = el.currentTime || 0;
      currentTimeRef.current = t;
      // Loop behaviour uses the ref so no store access needed
      const s = useDJStore.getState()[id];
      if (s.loop?.enabled && s.loop.in != null && s.loop.out != null && t >= s.loop.out) {
        el.currentTime = s.loop.in;
        currentTimeRef.current = s.loop.in;
        setDeck(id, { currentTime: s.loop.in });
        lastStoreWrite = performance.now();
        return;
      }
      const now = performance.now();
      if (now - lastStoreWrite > 250) {
        setDeck(id, { currentTime: t });
        lastStoreWrite = now;
      }
    });

    return () => { el.pause(); el.src = ""; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wavesurfer — scrolling waveform with centered playhead (Rekordbox/Traktor style)
  useEffect(() => {
    if (!waveRef.current || !audioElRef.current) return;
    const ws = WaveSurfer.create({
      container: waveRef.current,
      waveColor: "rgba(209, 10, 10, 0.55)",
      progressColor: accent || "#FF1F1F",
      cursorColor: "transparent",
      cursorWidth: 0,
      barWidth: 2,
      barRadius: 2,
      barGap: 1,
      height: 80,
      normalize: true,
      media: audioElRef.current,
      interact: true,
      autoScroll: true,
      autoCenter: true,
      minPxPerSec: 120,
      hideScrollbar: true,
      fillParent: false,
    });
    // Surface internal errors instead of silently swallowing them. The blank
    // waveform issue typically means an abort / CORS / decode error here that
    // we never saw. The fallback (feeding peaks from the BPM-decoded buffer
    // in loadTrack) covers correctness — this just makes the failure visible.
    ws.on("error", (err) => {
      const msg = err?.message || String(err);
      console.error(`[ws ${id}] error`, err);
      // Also surface as toast so the user can report what's failing without
      // needing DevTools. Suppress generic "AbortError" — that's the harmless
      // race when a new track load cancels the previous one.
      if (!/abort/i.test(msg)) {
        toast.error(`Deck ${label}: waveform load failed`, { description: msg, duration: 6000 });
      }
    });

    // Align audio start (t=0) to the centered playhead. Wavesurfer normally
    // puts t=0 at the LEFT edge of its scroll wrapper, so when the playhead
    // is centered the waveform's t=0 visually sits HALF A SCREEN to the left
    // of the playhead — meaning at currentTime=0 the playhead appears
    // 2-3 seconds AHEAD of where the music starts. Padding the scroll
    // container by half its width on both sides lets t=0 (and t=duration)
    // both reach center.
    const applyCenterPadding = () => {
      try {
        const wrapper = ws.getWrapper?.();
        const scroll = wrapper?.parentElement; // the .scroll element
        if (!scroll || !waveRef.current) return;
        const halfW = waveRef.current.clientWidth / 2;
        scroll.style.paddingLeft = `${halfW}px`;
        scroll.style.paddingRight = `${halfW}px`;
      } catch { /* noop */ }
    };
    ws.on("ready", applyCenterPadding);
    ws.on("redraw", applyCenterPadding);
    // Also re-apply on container resize
    const ro = new ResizeObserver(applyCenterPadding);
    ro.observe(waveRef.current);

    wsRef.current = ws;
    return () => {
      ro.disconnect();
      ws.destroy();
      wsRef.current = null;
    };
  }, [accent, id, label]);

  // EQ/Volume/Filter/Trim are wired by Mixer's ChannelStrip (single source of
  // truth). Removing them from Deck means Deck doesn't re-render on those
  // changes, which kept slider drags lag-free.

  // PFL / headphone cue on this deck
  useEffect(() => { chainRef.current?.setCueActive(!!deck.pflOn); }, [deck.pflOn]);

  // Tempo (playback rate) + keylock. Owned by <TempoRateBridge/> below so
  // tempo-fader drags don't re-render the Deck shell. Kept the keylock
  // wiring here since `keylock` is in the main subscription anyway.
  useEffect(() => {
    const el = audioElRef.current; if (!el) return;
    el.preservesPitch = deck.keylock;
  }, [deck.keylock]);

  const getCurrentTime = () => audioElRef.current?.currentTime || 0;
  const seekTo = (sec) => {
    if (!audioElRef.current) return;
    audioElRef.current.currentTime = sec;
  };

  // --- Scratch (platter grab) ----------------------------------------------
  // One full rotation = 1.8s of audio (matches 33 1/3 RPM industry standard).
  const SCRATCH_SEC_PER_ROTATION = 1.8;
  // Typical DJ controller jog wheel = ~128 ticks per full rotation.
  const JOG_TICKS_PER_ROTATION = 128;
  const JOG_SEC_PER_TICK = SCRATCH_SEC_PER_ROTATION / JOG_TICKS_PER_ROTATION;
  const scratchRef = useRef({ wasPlaying: false, baseTime: 0, savedRate: 1 });
  const [jogPulse, setJogPulse] = useState(0);
  const jogPulseTimer = useRef(null);

  // --- Jog Engine: pitch-bend (default) vs scratch (platter touched) -------
  // Real DJ controllers separate these two modes by a touch-sensitive top
  // ring on the platter. Without touch, the wheel BENDS the pitch — a
  // temporary speed nudge that decays back to the deck's true tempo. WITH
  // touch (or while the deck is paused), the wheel SCRATCHES — every tick
  // seeks the audio. Mapping that distinction is what makes a controller
  // feel "real" vs "arcade".
  //
  // Refs (instead of React state) so jog ticks at 60–200 Hz don't trigger
  // re-renders. setJogPulse is the only state write — and it's debounced
  // through requestAnimationFrame.
  const platterTouchedRef = useRef(false);
  const [platterTouched, setPlatterTouched] = useState(false);
  const bendRef = useRef(0);                // current pitch-bend amount
  const bendLoopRunningRef = useRef(false);
  const pendingScratchRef = useRef(0);      // accumulated scratch seek (sec)
  const scratchFlushRafRef = useRef(0);
  const scratchSavedRef = useRef(null);     // saved playback state during scratch
  const touchFailsafeTimerRef = useRef(null);
  const handleJogRef = useRef(null);
  const handlePlatterTouchRef = useRef(null);

  useEffect(() => {
    // Tunables ------------------------------------------------------------
    const BEND_PER_TICK = 0.0035;   // each tick adds this much to bend (~5% per fast spin)
    const BEND_DECAY    = 0.86;     // per-frame multiplier (faster = quicker return to true tempo)
    const BEND_THRESH   = 0.0008;   // below this, snap to zero
    const BEND_MAX      = 0.5;      // ±50% bend ceiling

    // Bend loop — runs while bend != 0, applies playbackRate = base × (1+bend),
    // and exponentially decays bend toward zero each frame.
    const startBendLoop = () => {
      if (bendLoopRunningRef.current) return;
      bendLoopRunningRef.current = true;
      const loop = () => {
        const el = audioElRef.current;
        bendRef.current *= BEND_DECAY;
        if (Math.abs(bendRef.current) < BEND_THRESH) bendRef.current = 0;
        if (el) {
          const tempoPct = useDJStore.getState()[id].tempoPct;
          const baseRate = 1 + tempoPct / 100;
          el.playbackRate = baseRate * (1 + bendRef.current);
        }
        if (bendRef.current === 0) {
          bendLoopRunningRef.current = false;
          // Final write so we land EXACTLY on base rate (avoids slow drift).
          if (el) {
            const tempoPct = useDJStore.getState()[id].tempoPct;
            el.playbackRate = 1 + tempoPct / 100;
          }
          return;
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };

    // Scratch flush — coalesces all jog ticks within an animation frame
    // into a single `currentTime` write. Without this, rapid CC bursts
    // hammer HTMLMediaElement seek and produce audible jitter.
    const flushScratch = () => {
      scratchFlushRafRef.current = 0;
      const el = audioElRef.current;
      const delta = pendingScratchRef.current;
      pendingScratchRef.current = 0;
      if (!el || delta === 0) return;
      const dur = el.duration || 0;
      const next = Math.max(0, Math.min(dur - 0.05, (el.currentTime || 0) + delta));
      try { el.currentTime = next; } catch { /* noop */ }
      setDeck(id, { currentTime: next });
    };

    handleJogRef.current = (ticks) => {
      const el = audioElRef.current;
      if (!el) return;
      // SCRATCH mode: platter touched OR audio paused.
      const scratching = platterTouchedRef.current || el.paused;
      if (scratching) {
        // 1. Drive the seek-based playhead (visual + tracks position)
        pendingScratchRef.current += ticks * JOG_SEC_PER_TICK;
        if (!scratchFlushRafRef.current) {
          scratchFlushRafRef.current = requestAnimationFrame(flushScratch);
        }
        // 2. Drive the audible scratch slice (real "wkka wkka" sound).
        // Only when platter is actually touched + we have a pre-decoded
        // buffer ready; otherwise stays silent (better than stutter).
        if (platterTouchedRef.current && hasScratchBuffer(id)) {
          scratchTick(id, ticks);
        }
        // Refresh failsafe — active scratching keeps the touch alive
        if (platterTouchedRef.current && touchFailsafeTimerRef.current) {
          clearTimeout(touchFailsafeTimerRef.current);
          touchFailsafeTimerRef.current = setTimeout(() => {
            if (platterTouchedRef.current) {
              console.warn(`[jog ${id}] platter touch failsafe — no activity 1.5s, auto-releasing`);
              handlePlatterTouchRef.current?.(false);
            }
          }, 1500);
        }
      } else {
        // PITCH BEND mode.
        bendRef.current = Math.max(-BEND_MAX, Math.min(BEND_MAX, bendRef.current + ticks * BEND_PER_TICK));
        if (bendRef.current !== 0) startBendLoop();
      }
      // Visual pulse on the platter — happens in EITHER mode so the on-
      // screen vinyl rotates with the wheel. Coalesced via setJogPulse.
      setJogPulse((p) => p + ticks * 0.12);
      if (jogPulseTimer.current) clearTimeout(jogPulseTimer.current);
      jogPulseTimer.current = setTimeout(() => setJogPulse(0), 220);
    };

    handlePlatterTouchRef.current = (pressed) => {
      platterTouchedRef.current = pressed;
      setPlatterTouched(pressed);
      const el = audioElRef.current;
      if (!el) return;

      // Failsafe: auto-release after 1.5s. Some controllers (and some
      // MIDI mappings) don't reliably send a "release" message — without
      // this guard, scratch mode could get stuck ON and lock playback.
      if (touchFailsafeTimerRef.current) {
        clearTimeout(touchFailsafeTimerRef.current);
        touchFailsafeTimerRef.current = null;
      }

      if (pressed) {
        // Engage scratch — kill any in-flight bend, pause audio so the
        // wheel is the ONLY thing moving the playhead (real DJ platter
        // behavior). Hand the playhead position to the scratch engine
        // so its buffer-slice player picks up at the right place.
        bendRef.current = 0;
        const tempoPct = useDJStore.getState()[id].tempoPct;
        scratchSavedRef.current = {
          rate: 1 + tempoPct / 100,
          wasPlaying: !el.paused,
        };
        if (!el.paused) {
          try { el.pause(); } catch { /* noop */ }
        }
        enterScratchMode(id, el.currentTime || 0);
        // Failsafe timer
        touchFailsafeTimerRef.current = setTimeout(() => {
          if (platterTouchedRef.current) {
            console.warn(`[jog ${id}] platter touch failsafe — no release within 1.5s, auto-releasing`);
            handlePlatterTouchRef.current?.(false);
          }
        }, 1500);
      } else {
        // Release — flush leftover scratch deltas, pull final position
        // from the scratch engine, then resume HTML5 playback.
        if (scratchFlushRafRef.current) {
          cancelAnimationFrame(scratchFlushRafRef.current);
          scratchFlushRafRef.current = 0;
          flushScratch();
        }
        const finalPos = exitScratchMode(id);
        if (finalPos != null) {
          try { el.currentTime = finalPos; } catch { /* noop */ }
        }
        const saved = scratchSavedRef.current;
        if (saved && saved.wasPlaying) {
          el.playbackRate = saved.rate;
          el.play().catch(() => {});
        }
        scratchSavedRef.current = null;
      }
    };

    return () => {
      if (scratchFlushRafRef.current) cancelAnimationFrame(scratchFlushRafRef.current);
      if (touchFailsafeTimerRef.current) clearTimeout(touchFailsafeTimerRef.current);
      handleJogRef.current = null;
      handlePlatterTouchRef.current = null;
    };
  }, [id, setDeck, JOG_SEC_PER_TICK]);

  const onScratchStart = useCallback(() => {
    const el = audioElRef.current;
    if (!el || !useDJStore.getState()[id].track) return;
    scratchRef.current.wasPlaying = !el.paused;
    scratchRef.current.baseTime = el.currentTime || 0;
    scratchRef.current.savedRate = el.playbackRate || 1;
    try { el.pause(); } catch { /* noop */ }
  }, [id]);

  const onScratchMove = useCallback((deltaRad) => {
    const el = audioElRef.current;
    if (!el || !useDJStore.getState()[id].track) return;
    const deltaSec = (deltaRad / (2 * Math.PI)) * SCRATCH_SEC_PER_ROTATION;
    const next = Math.max(0, Math.min((el.duration || 0) - 0.05, scratchRef.current.baseTime + deltaSec));
    try { el.currentTime = next; } catch { /* noop */ }
    setDeck(id, { currentTime: next });
  }, [id, setDeck]);

  const onScratchEnd = useCallback(() => {
    const el = audioElRef.current;
    if (!el) return;
    el.playbackRate = scratchRef.current.savedRate;
    el.preservesPitch = false;
    if (scratchRef.current.wasPlaying) {
      el.play().then(() => setDeck(id, { playing: true })).catch(() => {});
    }
  }, [id, setDeck]);

  // --- Waveform drag-to-scrub (Rekordbox-style) ----------------------------
  // Pixels-per-second matches WaveSurfer's `minPxPerSec` config (120).
  // Centered-playhead model: pulling the waveform RIGHT shows earlier audio
  // under the playhead → seek BACKWARD. So delta = -dx / pxPerSec.
  const WAVE_PX_PER_SEC = 120;
  const scrubRef = useRef({ active: false, startX: 0, baseTime: 0, wasPlaying: false, moved: false });

  const onWaveDragStart = useCallback((e) => {
    // Skip if click started on a marker (markers have their own click handlers).
    // Use composedPath because markers live inside wavesurfer's shadow DOM.
    const path = e.composedPath?.() || [];
    for (const node of path) {
      const tid = node?.dataset?.testid;
      if (tid && tid.includes("-marker-")) return;
    }

    const el = audioElRef.current;
    if (!el || !useDJStore.getState()[id].track) return;
    const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    scrubRef.current = {
      active: true,
      startX: x,
      baseTime: el.currentTime || 0,
      wasPlaying: !el.paused,
      moved: false,
    };
    // Audible scrubbing: do NOT pause. Each seek during the drag plays a
    // brief slice of audio, which gives an old-school "search" feel. True
    // reverse-vocal scratch isn't possible with HTML5 <audio> (would need
    // the AudioBuffer refactor that was reverted). Forward scrub sounds
    // close to natural; backward scrub sounds like rapid stutters.
    // If the deck was paused, keep it paused (silent scrub like before).
  }, [id]);

  useEffect(() => {
    const onMove = (e) => {
      const s = scrubRef.current;
      if (!s.active) return;
      const el = audioElRef.current;
      if (!el) return;
      const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const dx = x - s.startX;
      if (Math.abs(dx) > 2) s.moved = true;
      const deltaSec = -dx / WAVE_PX_PER_SEC;
      const dur = el.duration || 0;
      const next = Math.max(0, Math.min(dur - 0.05, s.baseTime + deltaSec));
      try { el.currentTime = next; } catch { /* noop */ }
      setDeck(id, { currentTime: next });
    };
    const onUp = () => {
      const s = scrubRef.current;
      if (!s.active) return;
      s.active = false;
      // We didn't pause on grab, so nothing to resume here. State is intact.
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [id, setDeck]);

  // Load track
  const loadTrack = useCallback(async (track) => {
    if (!track) return;
    setDeck(id, { loading: true, track, playing: false });
    const el = audioElRef.current;
    try {
      let playUrl = track.url;
      if (!playUrl && (track.source === "s3" || track.source === "demo")) {
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks/url?key=${encodeURIComponent(track.key)}`);
        const data = await res.json();
        playUrl = data.url.startsWith("http") ? data.url : `${process.env.REACT_APP_BACKEND_URL}${data.url}`;
      }
      el.src = playUrl;
      el.load();
      // Track wavesurfer's load promise so the BPM analyzer can wait on it
      // and reuse its decoded AudioBuffer instead of fetching the URL again
      // (3 concurrent fetches of the same MP3 caused waveform + BPM to both
      // drop out — single source of truth fixes that).
      const wsLoaded = wsRef.current
        ? wsRef.current.load(playUrl).catch((err) => { console.warn("[ws] load failed", err); })
        : Promise.resolve();
      setDeck(id, { loading: false, baseBPM: track.bpm || 120, cuePoint: 0, currentTime: 0, hotCues: Array(8).fill(null), loop: { in: null, out: null, enabled: false, beats: null }, syncedTo: null });

      // Auto-detect BPM with MongoDB cache. Flow:
      //   1. GET /api/tracks/meta?key=… → cached BPM + hot_cues, instant.
      //   2. Cache miss → fetch + decodeAudioData + analyzeBPM → POST result back.
      // Always non-blocking (fire-and-forget); never delays playback.
      (async () => {
        try {
          const trackKey = track.key;
          const apiBase = process.env.REACT_APP_BACKEND_URL;
          // 1. Cache lookup — pulls BPM, hot_cues, AND ID3 tags
          let needsTagRead = (track.source === "s3" || track.source === "demo");
          let bpmCached = false;
          try {
            const cacheRes = await fetch(`${apiBase}/api/tracks/meta?key=${encodeURIComponent(trackKey)}`);
            if (cacheRes.ok) {
              const cached = await cacheRes.json();
              const cur = useDJStore.getState()[id].track;
              if (cur?.key === trackKey) {
                const patch = {};
                if (cached?.bpm && isFinite(cached.bpm) && cached.bpm >= 60 && cached.bpm <= 200) {
                  patch.baseBPM = Math.round(cached.bpm * 10) / 10;
                  bpmCached = true;
                }
                // ID3 tags — overwrite the filename-derived defaults
                const tagPatch = {};
                if (cached?.title) tagPatch.name = cached.title;
                if (cached?.artist) tagPatch.artist = cached.artist;
                if (cached?.album) tagPatch.album = cached.album;
                if (cached?.cover) tagPatch.cover = cached.cover;
                if (Object.keys(tagPatch).length) {
                  patch.track = { ...cur, ...tagPatch };
                  needsTagRead = false; // cache had real tags
                }
                // Only restore cached cues if the user hasn't manually set any
                const liveCues = useDJStore.getState()[id].hotCues;
                const pristine = liveCues.every((c) => c == null);
                if (pristine && Array.isArray(cached?.hot_cues) && cached.hot_cues.length === 8) {
                  patch.hotCues = cached.hot_cues.map((v) => (v == null ? null : Number(v)));
                  cuesAlreadyPersistedRef.current = { key: trackKey, json: JSON.stringify(patch.hotCues) };
                }
                if (Object.keys(patch).length) setDeck(id, patch);
              }
              if (cached?.bpm && cached?.musical_key && !needsTagRead) {
                // BPM + key + tags all cached → skip BPM detect entirely.
                // Force-paint the waveform from a decoded buffer to dodge
                // wavesurfer's ready-vs-redraw race.
                (async () => {
                  try {
                    await wsLoaded;
                    if (useDJStore.getState()[id].track?.key !== trackKey) return;
                    let buf = null;
                    try { buf = wsRef.current?.getDecodedData?.(); } catch { /* ignore */ }
                    if (!buf) {
                      const resp = await fetch(playUrl);
                      if (!resp.ok) return;
                      const arr = await resp.arrayBuffer();
                      const ac = getAudioContext().ctx;
                      buf = await ac.decodeAudioData(arr.slice(0));
                    }
                    if (useDJStore.getState()[id].track?.key !== trackKey) return;
                    try { setScratchBuffer(id, buf); } catch (err) { console.warn(`[scratch ${id}] cached buffer register failed`, err); }
                    await paintWaveformFromBuffer({
                      ws: wsRef.current,
                      audioEl: audioElRef.current,
                      buf,
                      url: playUrl,
                      label: `${id} cached`,
                    });
                  } catch (err) {
                    console.warn(`[ws ${id}] cached-path peaks render threw`, err);
                  }
                })();
                return;
              }
            }
          } catch { /* network noise — fall through */ }

          // 1b. If S3 and tags weren't cached, read ID3 from the stream URL
          // and persist them. Read first 256KB only (album art usually fits).
          if (needsTagRead) {
            try {
              const tags = await readTagsFromUrl(playUrl);
              if (tags && (tags.title || tags.artist || tags.picture)) {
                const cur = useDJStore.getState()[id].track;
                if (cur?.key === trackKey) {
                  setDeck(id, {
                    track: {
                      ...cur,
                      name: tags.title || cur.name,
                      artist: tags.artist || cur.artist,
                      album: tags.album || cur.album,
                      cover: tags.picture || cur.cover,
                    },
                  });
                }
                fetch(`${apiBase}/api/tracks/meta`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    key: trackKey,
                    title: tags.title || undefined,
                    artist: tags.artist || undefined,
                    album: tags.album || undefined,
                    cover: tags.picture || undefined,
                  }),
                }).catch(() => {});
              }
            } catch { /* tag read failed — keep filename */ }
          }

          // 2. Cache miss → analyze BPM. Wait for wavesurfer to finish
          // loading so we can reuse its decoded AudioBuffer (one fetch, one
          // decode for both the waveform and the analyzer).
          setAnalyzingBPM(true);
          await wsLoaded;
          let buf = null;
          try {
            buf = wsRef.current?.getDecodedData?.();
          } catch { /* fallthrough to manual decode */ }
          if (!buf) {
            // Fallback: wavesurfer didn't expose its buffer (older version
            // or peaks-only mode). Fetch + decode ourselves.
            const resp = await fetch(playUrl);
            if (!resp.ok) throw new Error(`fetch ${resp.status}`);
            const arr = await resp.arrayBuffer();
            const ac = getAudioContext().ctx;
            buf = await ac.decodeAudioData(arr.slice(0));
          }
          // Register the decoded buffer with the scratch engine so the
          // platter can play real audio (forward + reversed) when touched.
          // Cheap one-time op per track — reverse buffer is built once on
          // setScratchBuffer.
          try { setScratchBuffer(id, buf); } catch (err) { console.warn(`[scratch ${id}] buffer register failed`, err); }
          // Force-paint waveform from the decoded buffer
          {
            const cur = useDJStore.getState()[id].track;
            if (cur?.key === trackKey) {
              await paintWaveformFromBuffer({
                ws: wsRef.current,
                audioEl: audioElRef.current,
                buf,
                url: playUrl,
                label: `${id} fresh`,
              });
            }
          }
          // Try the two algorithms web-audio-beat-detector ships:
          //   • analyze(buf) — returns a single tempo (occasionally falls
          //     back to ~120 when it can't lock onto rhythm).
          //   • guess(buf)   — returns { bpm, offset } using a different
          //     onset-correlation pass.
          // Take guess() as the answer when the two disagree by less than
          // 5%, otherwise prefer the one that's NOT exactly 120 (the
          // suspicious default).
          let bpm = null;
          if (!bpmCached) {
            let analyzeBpm = null;
            let guessBpm = null;
            try { analyzeBpm = await analyzeBPM(buf); } catch { /* ignore */ }
            try { const g = await guessBPM(buf); guessBpm = g?.bpm ?? null; } catch { /* ignore */ }
            if (analyzeBpm && guessBpm) {
              const diff = Math.abs(analyzeBpm - guessBpm) / Math.max(analyzeBpm, guessBpm);
              if (diff < 0.05) {
                bpm = guessBpm; // they agree → trust either, prefer guess (it's typically more stable)
              } else if (Math.round(analyzeBpm) === 120 && Math.round(guessBpm) !== 120) {
                bpm = guessBpm; // analyze defaulted, guess found something
              } else if (Math.round(guessBpm) === 120 && Math.round(analyzeBpm) !== 120) {
                bpm = analyzeBpm;
              } else {
                bpm = guessBpm; // disagree — prefer guess (more reliable per testing)
              }
            } else {
              bpm = analyzeBpm || guessBpm;
            }
            const cur = useDJStore.getState()[id].track;
            if (cur?.key !== trackKey) return;
            if (bpm && isFinite(bpm) && bpm >= 60 && bpm <= 200) {
              const rounded = Math.round(bpm * 10) / 10;
              setDeck(id, { baseBPM: rounded });
              toast.success(`Deck ${label}: BPM detected`, { description: `${rounded.toFixed(1)} BPM` });
              fetch(`${apiBase}/api/tracks/meta`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: trackKey, bpm }),
              }).catch(() => {});
            } else {
              toast.message(`Deck ${label}: BPM unclear`, {
                description: `Analyzer returned ${bpm}; keeping default. Adjust manually if needed.`,
              });
            }
          }
        } catch (err) {
          console.warn("[bpm] detection failed", err);
          toast.error(`Deck ${label}: BPM detection failed`, {
            description: err?.message || "Set BPM manually if needed.",
          });
        } finally {
          setAnalyzingBPM(false);
        }
      })();
    } catch (err) {
      console.error("load error", err);
      setDeck(id, { loading: false });
    }
  }, [id, setDeck]);

  // File from picker / drop with tag extraction
  const trackFromFile = useCallback(async (file, keyPrefix) => {
    const fallbackName = file.name.replace(/\.[^.]+$/, "");
    const url = URL.createObjectURL(file);
    const meta = await readTags(file);
    return {
      key: `${keyPrefix}-${Date.now()}`,
      name: meta.title || fallbackName,
      artist: meta.artist || "Unknown artist",
      album: meta.album || null,
      year: meta.year || null,
      genre: meta.genre || null,
      cover: meta.picture || null,
      url, bpm: meta.bpm || 120, source: "local",
    };
  }, []);

  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    loadTrack(await trackFromFile(file, "local"));
  };
  const onDrop = async (e) => {
    e.preventDefault();
    // Two drop sources:
    //   • Native file drag (uploads from desktop)
    //   • Drag from the in-app TrackLibrary (we set application/x-djlab-track on dragstart)
    const trackJson = e.dataTransfer.getData("application/x-djlab-track");
    if (trackJson) {
      try {
        const t = JSON.parse(trackJson);
        loadTrack(t);
        return;
      } catch { /* fall through to file path */ }
    }
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    loadTrack(await trackFromFile(file, "drop"));
  };

  // Mark track as played in MongoDB once it's been playing >= 30 seconds.
  // Skips local/drop tracks. Debounced via a ref so back-to-back loads of the
  // same track + scrubbing past 30s don't double-count. Triggers a window
  // event so the RecentlyPlayed strip refreshes immediately.
  const playedMarkedRef = useRef(null);
  useEffect(() => { playedMarkedRef.current = null; }, [deck.track?.key]);
  useEffect(() => {
    const trackKey = deck.track?.key;
    if (!trackKey || trackKey.startsWith("local-") || trackKey.startsWith("drop-")) return;
    if (playedMarkedRef.current === trackKey) return;
    if (!deck.playing) return;
    // Poll currentTimeRef every 1s — once we cross 30s, mark and stop polling.
    // Using a ref instead of subscribing to currentTime keeps the Deck tree
    // out of the per-tick reconciliation path, so knob/fader drags stay smooth.
    const t = setInterval(() => {
      if (playedMarkedRef.current === trackKey) { clearInterval(t); return; }
      if ((currentTimeRef.current || 0) < 30) return;
      playedMarkedRef.current = trackKey;
      clearInterval(t);
      fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks/played`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trackKey, deck: id === "deckA" ? "A" : "B" }),
      })
        .then(() => window.dispatchEvent(new CustomEvent("dj:track-played",
          { detail: { key: trackKey, deck: id === "deckA" ? "A" : "B" } })))
        .catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [deck.track?.key, deck.playing, id]);

  // Persist hot cues to MongoDB whenever they change. Debounced 600ms so
  // (their key is a one-off `local-<timestamp>` so caching them is pointless).
  // Skips the first observation per-track-key (treats it as the baseline) so
  // the all-null reset that happens during loadTrack doesn't overwrite the
  // cached cues in the DB.
  useEffect(() => {
    const trackKey = deck.track?.key;
    if (!trackKey || trackKey.startsWith("local-") || trackKey.startsWith("drop-")) return;
    const cuesJson = JSON.stringify(deck.hotCues);
    const ref = cuesAlreadyPersistedRef.current;
    // First time we see this track key → record as baseline, no POST
    if (ref.key !== trackKey) {
      cuesAlreadyPersistedRef.current = { key: trackKey, json: cuesJson };
      return;
    }
    if (cuesJson === ref.json) return; // unchanged
    const t = setTimeout(() => {
      cuesAlreadyPersistedRef.current = { key: trackKey, json: cuesJson };
      fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trackKey, hot_cues: deck.hotCues }),
      }).catch(() => { /* fire-and-forget */ });
    }, 600);
    return () => clearTimeout(t);
  }, [deck.hotCues, deck.track?.key]);

  // listen to dj:load
  useEffect(() => {
    const h = (ev) => { if (ev.detail?.deckId === id) loadTrack(ev.detail.track); };
    window.addEventListener("dj:load", h);
    return () => window.removeEventListener("dj:load", h);
  }, [id, loadTrack]);

  // Seek requests from the stacked beat-grid (top of the page)
  useEffect(() => {
    const h = (ev) => {
      if (ev.detail?.deckId !== id) return;
      const t = ev.detail.time;
      const el = audioElRef.current;
      if (!el || t == null) return;
      try { el.currentTime = Math.max(0, Math.min((el.duration || t) - 0.05, t)); } catch { /* noop */ }
      setDeck(id, { currentTime: el.currentTime });
    };
    window.addEventListener("dj:stacked-seek", h);
    return () => window.removeEventListener("dj:stacked-seek", h);
  }, [id, setDeck]);

  // Play/Pause/Cue
  const play = async () => {
    if (!deck.track) { toast.error("Load a track first", { description: `Deck ${label} is empty.` }); return; }
    await resumeAudioContext();
    try { await audioElRef.current.play(); setDeck(id, { playing: true }); }
    catch (e) { console.error("play failed", e); toast.error("Playback failed", { description: e.message || "Audio element refused to start." }); }
  };
  const pause = () => { audioElRef.current.pause(); setDeck(id, { playing: false }); };
  const togglePlay = () => (deck.playing ? pause() : play());
  const cue = () => {
    audioElRef.current.currentTime = deck.cuePoint || 0;
    if (!deck.playing) play();
  };
  const setCueHere = () => setDeck(id, { cuePoint: audioElRef.current.currentTime });

  // Sync: tempo + phase match the OTHER deck. Toggling.
  //   • Press once  → engage: BPM-match, phase-align beats, follow tempo changes
  //   • Press again → disengage: stop tracking; user keeps the last applied tempo
  //
  // We don't currently store an explicit beat grid (downbeat at t=0 is the
  // working assumption — the BPM detector treats the first audio frame as the
  // start of the bar). For the vast majority of cleanly-cut releases this is
  // accurate; for tracks with long intros / pickup notes the user can nudge
  // with the tempo fader after engaging sync.
  // Half/double-tempo aware sync: tries 3 candidate targets — exact, half,
  // double — and picks whichever lands closest to my baseBPM. Solves the
  // classic BPM-detector confusion where a 82 BPM hip-hop track gets read as
  // 164 BPM and naive sync would yank the follower into a +50% pitch.
  const computeSyncTarget = (myBaseBPM, otherCurrentBPM, tempoRange) => {
    const candidates = [
      { ratio: 1,   label: "" },
      { ratio: 0.5, label: " ÷2" },
      { ratio: 2,   label: " ×2" },
    ];
    let best = null;
    for (const c of candidates) {
      const target = otherCurrentBPM * c.ratio;
      const pct = (target / myBaseBPM - 1) * 100;
      // Prefer candidates whose pct fits within tempoRange. Among those, the
      // smallest absolute pct wins (closest to the follower's natural pitch).
      const fits = Math.abs(pct) <= tempoRange + 0.001;
      const score = fits ? Math.abs(pct) : 1000 + Math.abs(pct);
      if (best == null || score < best.score) {
        best = { ...c, target, pct, fits, score };
      }
    }
    return best;
  };

  const sync = () => {
    const otherId = id === "deckA" ? "deckB" : "deckA";
    const s = useDJStore.getState();
    const me = s[id];
    const other = s[otherId];

    // Already synced → release
    if (me.syncedTo === otherId) {
      setSyncedTo(id, null);
      toast.message(`Sync released — Deck ${id === "deckA" ? "A" : "B"}`);
      return;
    }

    if (!other?.track || !me.baseBPM || !other.baseBPM) {
      toast.error("Sync needs a track loaded on both decks");
      return;
    }

    // 1) BPM match — half/double aware, clamped to tempo range
    const otherBPM = other.baseBPM * (1 + (other.tempoPct || 0) / 100);
    const best = computeSyncTarget(me.baseBPM, otherBPM, me.tempoRange);
    const clamped = Math.max(-me.tempoRange, Math.min(me.tempoRange, best.pct));
    setDeck(id, { tempoPct: clamped });

    // Phase period uses the chosen ratio so beats line up at the matched
    // tempo (half-time sync = beats every two master beats).
    const followerEffectiveBPM = me.baseBPM * (1 + clamped / 100);

    // 2) Phase align — snap follower's currentTime to the nearest beat
    //    grid match of the master deck. Reads live currentTime from each
    //    audio element to avoid the 4Hz store-tick lag.
    const myEl = audioElRef.current;
    const otherEl = getDeckAudioEl(otherId);
    if (myEl && otherEl && myEl.duration && otherEl.duration) {
      const beatPeriod = 60 / followerEffectiveBPM;     // seconds per follower beat
      const masterT = otherEl.currentTime || 0;
      const myT = myEl.currentTime || 0;
      const masterPhase = ((masterT % beatPeriod) + beatPeriod) % beatPeriod;
      const myPhase = ((myT % beatPeriod) + beatPeriod) % beatPeriod;
      let delta = masterPhase - myPhase;
      if (delta > beatPeriod / 2) delta -= beatPeriod;
      if (delta < -beatPeriod / 2) delta += beatPeriod;
      const target = Math.max(0, Math.min(myEl.duration - 0.05, myT + delta));
      try { myEl.currentTime = target; } catch { /* noop */ }
      currentTimeRef.current = target;
      setDeck(id, { currentTime: target });
    }

    // 3) Engage: this deck now follows the other's tempo until released
    setSyncedTo(id, otherId);
    toast.success(`Synced to Deck ${otherId === "deckA" ? "A" : "B"}`, {
      description: `${followerEffectiveBPM.toFixed(1)} BPM${best.label} · phase aligned`,
      duration: 2200,
    });
  };

  // While sync is engaged, follow the master deck's tempo. Subscribes
  // imperatively to dodge a Deck-wide re-render on every tempoPct tick.
  useEffect(() => {
    if (!deck.syncedTo) return;
    const otherId = deck.syncedTo;
    const recompute = () => {
      const s = useDJStore.getState();
      const me = s[id];
      const other = s[otherId];
      if (me.syncedTo !== otherId || !me.baseBPM || !other?.baseBPM) return;
      const otherBPM = other.baseBPM * (1 + (other.tempoPct || 0) / 100);
      const best = computeSyncTarget(me.baseBPM, otherBPM, me.tempoRange);
      const clamped = Math.max(-me.tempoRange, Math.min(me.tempoRange, best.pct));
      if (Math.abs(clamped - (me.tempoPct || 0)) > 0.005) {
        setDeck(id, { tempoPct: clamped });
      }
    };
    const unsub = useDJStore.subscribe((state, prev) => {
      const o = state[otherId]; const p = prev[otherId];
      if (!o || !p) return;
      if (o.baseBPM === p.baseBPM && o.tempoPct === p.tempoPct) return;
      recompute();
    });
    recompute();
    return () => unsub?.();
  }, [deck.syncedTo, id, setDeck]);

  const toggleTempoRange = () => setDeck(id, { tempoRange: deck.tempoRange === 8 ? 16 : 8 });

  // Beat flash from analyser. Read `playing` fresh from the store each frame
  // so the flash only fires when the deck is actually playing — not when the
  // analyser picks up ambient noise from other decks passing through the
  // shared master bus, and not from a stale closure after pause.
  useEffect(() => {
    const c = chainRef.current; if (!c) return;
    const analyser = c.analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let lastFlash = 0;
    const loop = () => {
      const s = useDJStore.getState()[id];
      if (s.playing) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (rms > 0.18 && now - lastFlash > 180) {
          setBeatFlash(true); lastFlash = now;
          setTimeout(() => setBeatFlash(false), 90);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // MIDI / keyboard actions
  useEffect(() => {
    const doAction = (action, value, detail) => {
      const prefix = `${id}.`;
      if (!action.startsWith(prefix)) return;
      const sub = action.slice(prefix.length);
      if (sub === "play")   togglePlay();
      else if (sub === "cue") cue();
      else if (sub === "sync") sync();
      else if (sub === "pfl") setPfl(id, !deck.pflOn);
      else if (sub === "keylock") setDeck(id, { keylock: !deck.keylock });
      else if (sub === "platterTouch") {
        // Touch top of platter → switch jog mode from pitch-bend to scratch.
        // Release → switch back. handlePlatterTouchRef is set up below in
        // the jog-engine effect.
        handlePlatterTouchRef.current?.(!!detail?.pressed);
      }
      else if (sub === "loopIn") {
        const t = audioElRef.current?.currentTime ?? 0;
        setLoop(id, { in: t, enabled: false, beats: null });
      }
      else if (sub === "loopOut") {
        const t = audioElRef.current?.currentTime ?? 0;
        const curLoop = useDJStore.getState()[id].loop;
        if (curLoop?.in != null && t > curLoop.in) {
          setLoop(id, { out: t, enabled: true });
        }
      }
      else if (sub === "jog") {
        // Routed through the dedicated jog engine below — supports both
        // pitch-bend (no touch + playing) and scratch (touch OR paused),
        // with rAF-coalesced seek writes (zero jitter) and exponentially
        // decaying bend (no permanent BPM drift).
        handleJogRef.current?.(value);
      }
      else if (sub === "volume")  setDeck(id, { volume: value });
      else if (sub === "tempo")   setDeck(id, { tempoPct: Math.max(-deck.tempoRange, Math.min(deck.tempoRange, value * deck.tempoRange)) });
      else if (sub === "trim")    setDeck(id, { trim: Math.max(-12, Math.min(12, value)) });
      else if (sub === "filter")  setDeck(id, { filter: Math.max(-1, Math.min(1, value)) });
      else if (sub === "fx1.enabled") useDJStore.getState().setFX(id, "fx1", { enabled: !deck.fx1.enabled });
      else if (sub === "fx2.enabled") useDJStore.getState().setFX(id, "fx2", { enabled: !deck.fx2.enabled });
      else if (sub === "fx1.amount")  useDJStore.getState().setFX(id, "fx1", { amount: Math.max(0, Math.min(1, value)) });
      else if (sub === "fx2.amount")  useDJStore.getState().setFX(id, "fx2", { amount: Math.max(0, Math.min(1, value)) });
      else if (sub === "fx1.next") {
        const cur = ["reverb", "delay", "flanger"].indexOf(deck.fx1.effect);
        const next = ["reverb", "delay", "flanger"][(cur + 1) % 3];
        useDJStore.getState().setFX(id, "fx1", { effect: next });
      }
      else if (sub === "fx2.next") {
        const cur = ["reverb", "delay", "flanger"].indexOf(deck.fx2.effect);
        const next = ["reverb", "delay", "flanger"][(cur + 1) % 3];
        useDJStore.getState().setFX(id, "fx2", { effect: next });
      }
      else if (sub === "eq.low")  setDeckEQ(id, "low", value);
      else if (sub === "eq.mid")  setDeckEQ(id, "mid", value);
      else if (sub === "eq.high") setDeckEQ(id, "high", value);
      else if (sub.startsWith("hotcue.")) {
        const slot = parseInt(sub.split(".")[1], 10) - 1;
        const existing = deck.hotCues[slot];
        if (existing == null) setHotCue(id, slot, getCurrentTime());
        else seekTo(existing);
      }
    };
    const mh = (e) => doAction(e.detail.action, e.detail.value, e.detail);
    window.addEventListener("dj:action", mh);

    // Keyboard shortcuts (only when not typing in an input)
    const kh = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      const shiftA = !e.shiftKey; // no-modifier = deck A (for digits)
      const shiftB = e.shiftKey;
      // Hot cues 1-8
      if (/^[1-8]$/.test(e.key)) {
        if ((id === "deckA" && shiftA) || (id === "deckB" && shiftB)) {
          const slot = parseInt(e.key, 10) - 1;
          const existing = deck.hotCues[slot];
          if (existing == null) setHotCue(id, slot, getCurrentTime());
          else seekTo(existing);
          e.preventDefault();
        }
      }
      // Deck A: space = play (with no modifier), Deck B: shift+space
      if (e.code === "Space" && ((id === "deckA" && !e.shiftKey) || (id === "deckB" && e.shiftKey))) {
        togglePlay(); e.preventDefault();
      }
    };
    window.addEventListener("keydown", kh);
    return () => { window.removeEventListener("dj:action", mh); window.removeEventListener("keydown", kh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.playing, deck.track, deck.hotCues, deck.tempoRange, deck.pflOn]);

  return (
    <div
      data-testid={`deck-${letter}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="relative flex flex-col gap-2 bg-[#141414]/80 backdrop-blur-xl border border-white/10 p-3 rounded-lg"
    >
      {/* Tempo→playbackRate writer (zero DOM). Owns its own tempoPct
          subscription so tempo drags don't re-render the Deck shell. */}
      <TempoRateBridge deckId={id} audioElRef={audioElRef} />
      {/* beat-glow overlay */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none border-2"
        style={{
          borderColor: beatFlash ? accent : "transparent",
          boxShadow: beatFlash ? `inset 0 0 40px ${accent}88, 0 0 24px ${accent}66` : "none",
          transition: "all 120ms ease-out",
        }}
      />

      {/* Top: vinyl + meta */}
      <div className="flex items-center gap-3 relative">
        <SpinningVinyl
          spinning={deck.playing}
          label={label}
          size={72}
          cover={deck.track?.cover || null}
          onScratchStart={onScratchStart}
          onScratchMove={onScratchMove}
          onScratchEnd={onScratchEnd}
          externalAngle={jogPulse}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="label-tiny" style={{ color: accent }}>DECK {label}</span>
            <span className="label-tiny truncate">{deck.track?.source || "—"}</span>
          </div>
          <div className="flex items-center gap-2 min-w-0 mt-0.5">
            {deck.track?.cover && (
              <img src={deck.track.cover} alt="" data-testid={`deck-${letter}-cover`}
                   className="w-8 h-8 rounded object-cover shrink-0 border border-white/10" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-display font-bold text-sm truncate" data-testid={`deck-${letter}-title`}>
                {deck.track?.name || "No track loaded"}
              </div>
              <div className="text-[10px] text-[#A1A1AA] truncate" data-testid={`deck-${letter}-artist`}>
                {deck.track ? (deck.track.artist || "Unknown artist") : "Drag & drop or pick from library"}
              </div>
            </div>
          </div>

          <div className="mt-1 flex items-center justify-between gap-2">
            <DeckTimeReadout deckId={id} />
            <div className="flex items-center gap-1.5">
              {/* Jog mode indicator — only visible while jog is active */}
              {(platterTouched || Math.abs(jogPulse) > 0.05) && (
                <span
                  data-testid={`deck-${letter}-jog-mode`}
                  className="font-mono-dj text-[9px] font-bold tracking-[0.2em] px-1.5 py-0.5 rounded border"
                  style={{
                    color: platterTouched ? "#FF1F1F" : "#FFE500",
                    borderColor: platterTouched ? "#FF1F1F" : "#FFE500",
                    background: (platterTouched ? "#FF1F1F" : "#FFE500") + "20",
                  }}
                >
                  {platterTouched ? "SCRATCH" : "BEND"}
                </span>
              )}
              <div className="label-tiny">BPM</div>
              <div className="font-mono-dj font-bold text-base leading-none" style={{ color: accent }} data-testid={`deck-${letter}-bpm`}>
                <CurrentBPM deckId={id} baseBPM={deck.baseBPM} />
              </div>
              {analyzingBPM && (
                <Activity className="w-3 h-3 text-[#FF9500] animate-pulse" data-testid={`deck-${letter}-bpm-analyzing`}
                          aria-label="Analyzing BPM" />
              )}
              <BPMInput deckId={id} letter={letter} baseBPM={deck.baseBPM} setDeck={setDeck} />
              <button
                type="button"
                data-testid={`deck-${letter}-bpm-halve`}
                onClick={() => setDeck(id, { baseBPM: Math.max(40, Math.min(220, deck.baseBPM / 2)) })}
                disabled={!deck.track || deck.baseBPM / 2 < 40}
                className="px-1 py-0.5 rounded border border-white/15 text-[8px] font-bold tracking-wider text-[#A1A1AA] hover:text-white hover:border-white/40 transition disabled:opacity-30 disabled:cursor-not-allowed"
                title="Half-time (÷2) — fix BPM if detector picked the doubled tempo"
              >÷2</button>
              <button
                type="button"
                data-testid={`deck-${letter}-bpm-double`}
                onClick={() => setDeck(id, { baseBPM: Math.max(40, Math.min(220, deck.baseBPM * 2)) })}
                disabled={!deck.track || deck.baseBPM * 2 > 220}
                className="px-1 py-0.5 rounded border border-white/15 text-[8px] font-bold tracking-wider text-[#A1A1AA] hover:text-white hover:border-white/40 transition disabled:opacity-30 disabled:cursor-not-allowed"
                title="Double-time (×2) — fix BPM if detector picked the half tempo"
              >×2</button>
            </div>
          </div>
        </div>
      </div>

      {/* Waveform — scrolling with centered playhead. Canvas auto-fills the
          container so peaks render across the full deck space. Drag the
          waveform left/right to scrub through the track (Rekordbox-style). */}
      <div className="relative rounded overflow-hidden border border-white/10 h-[80px] cursor-grab active:cursor-grabbing select-none"
           onMouseDown={onWaveDragStart}
           onTouchStart={onWaveDragStart}
           style={{
             background:
               "repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 40px), " +
               "linear-gradient(180deg, #050505 0%, #0b0b0b 50%, #050505 100%)",
           }}>
        <div ref={waveRef} data-testid={`deck-${letter}-waveform`} className="absolute inset-0" />
        {/* Hot cue markers — injected into wavesurfer's scrolling wrapper so
            they pass under the centered playhead in lock-step with the audio. */}
        <HotCueMarkers deckId={id} wsRef={wsRef} audioElRef={audioElRef} seekTo={seekTo} />
        {/* Centered playhead */}
        <div className="absolute top-0 bottom-0 left-1/2 pointer-events-none z-10"
             style={{
               width: "2px",
               marginLeft: "-1px",
               background: accent,
               boxShadow: `0 0 8px ${accent}, 0 0 2px ${accent}`,
             }} />
        {/* Center triangle markers top/bottom */}
        <div className="absolute top-0 left-1/2 pointer-events-none z-10"
             style={{
               marginLeft: "-5px",
               width: 0, height: 0,
               borderLeft: "5px solid transparent",
               borderRight: "5px solid transparent",
               borderTop: `6px solid ${accent}`,
             }} />
        {!deck.track && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="font-mono-dj text-[10px] tracking-[0.3em] uppercase text-white/20">
              Load a track
            </span>
          </div>
        )}
      </div>

      {/* Controls row 1 — Transport | Keylock | Tempo (single compact row, no wrap) */}
      <div className="flex items-center gap-2">
        {/* Transport */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            data-testid={`deck-${letter}-cue`}
            onClick={cue} onDoubleClick={setCueHere}
            title="Cue (dbl-click to set cue point)"
            className="w-9 h-9 rounded-full border border-white/20 hover:border-[#FF1F1F] hover:shadow-[0_0_12px_#FF1F1F] transition-all flex items-center justify-center bg-[#0a0a0a] shrink-0"
          >
            <SkipBack className="w-3 h-3 text-white" />
          </button>
          <button
            data-testid={`deck-${letter}-play`}
            onClick={togglePlay} disabled={!deck.track}
            className={`w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all shrink-0 ${
              deck.playing
                ? "bg-[#D10A0A] border-[#FF1F1F] shadow-[0_0_20px_#FF1F1F]"
                : "border-white/20 hover:border-[#FF1F1F] hover:shadow-[0_0_12px_#FF1F1F]"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {deck.playing ? <Pause className="w-4 h-4 text-white" fill="currentColor" /> : <Play className="w-4 h-4 text-white ml-0.5" fill="currentColor" />}
          </button>
          <button
            data-testid={`deck-${letter}-pfl`}
            onClick={() => setPfl(id, !deck.pflOn)}
            title="Headphone Cue (PFL)"
            className={`w-9 h-9 rounded-full border flex items-center justify-center transition-all shrink-0 ${
              deck.pflOn
                ? "bg-[#D10A0A] border-[#FF1F1F] text-white shadow-[0_0_12px_#FF1F1F]"
                : "border-white/20 text-[#A1A1AA] hover:border-white/50 hover:text-white"
            }`}
          >
            <Headphones className="w-3 h-3" />
          </button>
        </div>

        {/* Keylock + tempo range (stacked vertically, compact) */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={() => setDeck(id, { keylock: !deck.keylock })}
            data-testid={`deck-${letter}-keylock`}
            title="Keylock — preserve pitch when tempo changes"
            className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-[0.1em] border transition ${
              deck.keylock
                ? "border-[#FF1F1F] text-[#FF1F1F] bg-[#D10A0A]/20"
                : "border-white/20 text-[#A1A1AA] hover:border-white/40 hover:text-white"
            }`}
          >
            Keylock
          </button>
          <button data-testid={`deck-${letter}-tempo-range`} onClick={toggleTempoRange}
            className="px-1.5 py-0.5 rounded border border-white/15 text-[9px] font-bold uppercase tracking-[0.1em] text-[#A1A1AA] hover:text-white hover:border-white/30">
            ±{deck.tempoRange}%
          </button>
        </div>

        {/* Tempo pct readout + Sync (actual fader moved to mixer strip) */}
        <div className="flex flex-col gap-1 flex-1 min-w-0 pl-2 border-l border-white/10">
          <div className="flex items-center justify-between">
            <span className="label-tiny">TEMPO</span>
            <span className="font-mono-dj text-[10px] font-bold" style={{ color: accent }} data-testid={`deck-${letter}-tempo-readout`}>
              <TempoPctReadout deckId={id} />
            </span>
          </div>
          <button data-testid={`deck-${letter}-sync`} onClick={sync}
            disabled={!deck.track}
            title={deck.syncedTo ? "Sync engaged — click to release" : "Beat & tempo sync to the other deck"}
            className={`px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-[0.2em] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              deck.syncedTo
                ? "border-[#FF1F1F] bg-[#D10A0A]/30 text-[#FF6B6B] shadow-[0_0_10px_#FF1F1F88]"
                : "border-white/20 bg-transparent hover:bg-[#D10A0A]/20 hover:border-[#D10A0A] hover:text-[#FF1F1F]"
            }`}>
            {deck.syncedTo ? "Sync ●" : "Sync"}
          </button>
        </div>

        {/* Load file — inline, right side */}
        <label className="shrink-0 px-2 py-1 rounded border border-white/10 text-[9px] font-bold uppercase tracking-[0.15em] text-[#A1A1AA] hover:text-white hover:border-white/30 cursor-pointer flex items-center gap-1"
          data-testid={`deck-${letter}-upload`} title="Load audio file">
          <Upload className="w-3 h-3" />
          Load
          <input type="file" accept="audio/*" className="hidden" onChange={onFile} />
        </label>
      </div>

      {/* Controls row 2 — Hot cues + Loop + single FX rack */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <HotCuePad deckId={id} deckLetter={letter} getCurrentTime={getCurrentTime} seekTo={seekTo} />
        <LoopControls deckId={id} deckLetter={letter} getCurrentTime={getCurrentTime} seekTo={seekTo} />
        <div className="flex" data-testid={`deck-${letter}-fx-rack`}>
          <FXSlot deckId={id} slotKey="fx1" chain={chainRef.current} />
        </div>
      </div>

    </div>
  );
}

/**
 * Time readout — isolates the 4 Hz currentTime tick away from the parent
 * Deck shell so dragging a knob/fader on one deck doesn't compete with the
 * full Deck reconciliation on every playback tick.
 */
function DeckTimeReadout({ deckId }) {
  const currentTime = useDJStore((s) => s[deckId].currentTime);
  const duration = useDJStore((s) => s[deckId].duration);
  return (
    <span className="font-mono-dj text-[10px] text-[#A1A1AA]">
      {formatTime(currentTime)} / {formatTime(duration)}
    </span>
  );
}

/**
 * Live BPM readout (baseBPM × tempoPct). Subscribes to tempoPct in isolation
 * so tempo-fader drags only re-render this 1-line element, not the Deck.
 */
function CurrentBPM({ deckId, baseBPM }) {
  const tempoPct = useDJStore((s) => s[deckId].tempoPct);
  return baseBPM ? (baseBPM * (1 + tempoPct / 100)).toFixed(1) : "—";
}

/**
 * Tempo-percent readout ("+2.4%"). Same isolation reason as CurrentBPM.
 */
function TempoPctReadout({ deckId }) {
  const tempoPct = useDJStore((s) => s[deckId].tempoPct);
  return <>{tempoPct > 0 ? "+" : ""}{tempoPct.toFixed(1)}%</>;
}

/**
 * Writes tempoPct → audio element's playbackRate. Renders nothing.
 * Throttled to 33fps so rapid drags don't make the HTMLMediaElement decoder
 * stutter. Lives outside Deck's main subscription so tempo drags don't
 * cascade re-renders into the deck shell (vinyl, hot cues, loops, FX).
 */
function TempoRateBridge({ deckId, audioElRef }) {
  const tempoPct = useDJStore((s) => s[deckId].tempoPct);
  const writeRef = useRef({ rate: 1, lastWrite: 0 });
  useEffect(() => {
    const el = audioElRef.current; if (!el) return;
    const targetRate = 1 + tempoPct / 100;
    const delta = Math.abs(targetRate - writeRef.current.rate);
    const now = performance.now();
    if (delta > 0.005 || now - writeRef.current.lastWrite > 30) {
      el.playbackRate = targetRate;
      writeRef.current = { rate: targetRate, lastWrite: now };
    }
  }, [tempoPct, audioElRef]);
  return null;
}
