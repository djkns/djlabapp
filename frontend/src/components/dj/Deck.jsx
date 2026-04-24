import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, SkipBack, Upload, Headphones } from "lucide-react";
import SpinningVinyl from "./SpinningVinyl";
import EQKnob from "./EQKnob";
import HotCuePad from "./HotCuePad";
import LoopControls from "./LoopControls";
import FXSlot from "./FXSlot";
import { useDJStore } from "@/store/djStore";
import { useShallow } from "zustand/react/shallow";
import { createDeckChain, createBufferPlayer, registerDeckChain, registerBufferPlayer, resumeAudioContext } from "@/lib/audioEngine";
import { readTags } from "@/lib/mediaTags";
import { toast } from "sonner";

const formatTime = (s) => {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export default function Deck({ id, label, accent }) {
  const letter = id === "deckA" ? "a" : "b";
  const waveRef = useRef(null);
  const wsRef = useRef(null);
  const chainRef = useRef(null);
  const playerRef = useRef(null);
  const rafRef = useRef(null);
  const positionRafRef = useRef(null);
  const [trackUrl, setTrackUrl] = useState(null);

  const deck = useDJStore(useShallow((s) => ({
    track: s[id].track,
    playing: s[id].playing,
    currentTime: s[id].currentTime,
    duration: s[id].duration,
    baseBPM: s[id].baseBPM,
    tempoPct: s[id].tempoPct,
    tempoRange: s[id].tempoRange,
    pflOn: s[id].pflOn,
    cuePoint: s[id].cuePoint,
    hotCues: s[id].hotCues,
  })));
  const otherDeck = useDJStore(useShallow((s) => ({
    track: id === "deckA" ? s.deckB.track : s.deckA.track,
    currentBPM: (id === "deckA" ? s.deckB : s.deckA).baseBPM *
                (1 + (id === "deckA" ? s.deckB : s.deckA).tempoPct / 100),
  })));
  const setDeck = useDJStore((s) => s.setDeck);
  const setDeckEQ = useDJStore((s) => s.setDeckEQ);
  const setHotCue = useDJStore((s) => s.setHotCue);
  const setPfl = useDJStore((s) => s.setPfl);

  const [beatFlash, setBeatFlash] = useState(false);

  // Chain + BufferPlayer
  useEffect(() => {
    try {
      chainRef.current = createDeckChain();
      playerRef.current = createBufferPlayer(chainRef.current);
      registerDeckChain(id, chainRef.current);
      registerBufferPlayer(id, playerRef.current);
      window.dispatchEvent(new CustomEvent("dj:chain-ready", { detail: { deckId: id, chain: chainRef.current } }));

      playerRef.current.setOnEnded(() => setDeck(id, { playing: false, currentTime: 0 }));
    } catch (err) { console.error("deck chain error", err); }

    // Position RAF: drives waveform cursor + loop boundary check + UI clock.
    // Store writes throttled to 4Hz; cursor writes to Wavesurfer at ~30fps.
    let lastStoreWrite = 0;
    let lastCursorWrite = 0;
    const positionLoop = () => {
      const player = playerRef.current;
      if (player && player.isPlaying?.()) {
        const t = player.getCurrentTime();
        const s = useDJStore.getState()[id];
        // Loop enforcement
        if (s.loop?.enabled && s.loop.in != null && s.loop.out != null && t >= s.loop.out) {
          player.seek(s.loop.in);
          setDeck(id, { currentTime: s.loop.in });
          lastStoreWrite = performance.now();
        } else {
          const now = performance.now();
          if (now - lastStoreWrite > 250) {
            setDeck(id, { currentTime: t });
            lastStoreWrite = now;
          }
          if (wsRef.current && now - lastCursorWrite > 33) {
            try { wsRef.current.setTime(t); } catch { /* not ready */ }
            lastCursorWrite = now;
          }
        }
      }
      positionRafRef.current = requestAnimationFrame(positionLoop);
    };
    positionRafRef.current = requestAnimationFrame(positionLoop);

    return () => {
      if (positionRafRef.current) cancelAnimationFrame(positionRafRef.current);
      try { playerRef.current?.stop(false); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wavesurfer — scrolling waveform with centered playhead (Rekordbox/Traktor style).
  // In buffer-player mode Wavesurfer is display-only; the actual audio plays
  // through the AudioBufferSourceNode. Cursor position is driven by the RAF
  // position loop calling ws.setTime(). Clicks emit `interaction` events that
  // seek the buffer player.
  useEffect(() => {
    if (!waveRef.current) return;
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
      interact: true,
      autoScroll: true,
      autoCenter: true,
      minPxPerSec: 120,
      hideScrollbar: true,
      fillParent: false,
    });
    // Wavesurfer fires 'interaction' when the user clicks/scrubs the waveform
    // (Wavesurfer v7 API). We seek the buffer player — not the waveform — to
    // keep timing authoritative.
    ws.on("interaction", (t) => {
      const p = playerRef.current;
      if (!p) return;
      p.seek(t);
      setDeck(id, { currentTime: t });
    });
    wsRef.current = ws;
    return () => { ws.destroy(); wsRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent]);

  // Load the audio URL into Wavesurfer when trackUrl changes (decoded
  // separately for display — cheaper than decoding from same blob).
  useEffect(() => {
    if (!wsRef.current || !trackUrl) return;
    wsRef.current.load(trackUrl).catch(() => { /* ignore */ });
  }, [trackUrl]);

  // EQ/Volume/Filter/Trim are wired by Mixer's ChannelStrip (single source of
  // truth). Removing them from Deck means Deck doesn't re-render on those
  // changes, which kept slider drags lag-free.

  // PFL / headphone cue on this deck
  useEffect(() => { chainRef.current?.setCueActive(!!deck.pflOn); }, [deck.pflOn]);

  // Tempo (playback rate). AudioBufferSourceNode.playbackRate is a smooth
  // AudioParam — setTargetAtTime in the player ramps for glitch-free tempo
  // changes. No decoder re-sync, no clicks.
  useEffect(() => {
    const p = playerRef.current; if (!p) return;
    p.setPlaybackRate(1 + deck.tempoPct / 100);
  }, [deck.tempoPct]);

  const getCurrentTime = () => playerRef.current?.getCurrentTime() || 0;
  const seekTo = (sec) => {
    const p = playerRef.current;
    if (!p) return;
    p.seek(sec);
    setDeck(id, { currentTime: sec });
    try { wsRef.current?.setTime(sec); } catch { /* ignore */ }
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

  const onScratchStart = useCallback(() => {
    const p = playerRef.current;
    if (!p || !useDJStore.getState()[id].track) return;
    scratchRef.current.wasPlaying = p.isPlaying();
    scratchRef.current.baseTime = p.getCurrentTime();
    scratchRef.current.savedRate = 1 + (useDJStore.getState()[id].tempoPct / 100);
    try { p.pause(); } catch { /* noop */ }
  }, [id]);

  const onScratchMove = useCallback((deltaRad) => {
    const p = playerRef.current;
    if (!p || !useDJStore.getState()[id].track) return;
    const deltaSec = (deltaRad / (2 * Math.PI)) * SCRATCH_SEC_PER_ROTATION;
    const duration = p.getDuration();
    const next = Math.max(0, Math.min((duration || 0) - 0.05, scratchRef.current.baseTime + deltaSec));
    try { p.seek(next); } catch { /* noop */ }
    setDeck(id, { currentTime: next });
  }, [id, setDeck]);

  const onScratchEnd = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    p.setPlaybackRate(scratchRef.current.savedRate);
    if (scratchRef.current.wasPlaying) {
      p.play();
      setDeck(id, { playing: true });
    }
  }, [id, setDeck]);

  // Load track — fetch + decode into AudioBuffer via BufferPlayer
  const loadTrack = useCallback(async (track) => {
    if (!track) return;
    setDeck(id, { loading: true, track, playing: false });
    const p = playerRef.current;
    if (!p) return;
    try {
      let playUrl = track.url;
      if (!playUrl && (track.source === "s3" || track.source === "demo")) {
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks/url?key=${encodeURIComponent(track.key)}`);
        const data = await res.json();
        playUrl = data.url.startsWith("http") ? data.url : `${process.env.REACT_APP_BACKEND_URL}${data.url}`;
      }
      // Tell Wavesurfer about the URL for visual display only
      setTrackUrl(playUrl);
      // Decode into AudioBuffer for playback
      const duration = await p.loadFromUrl(playUrl);
      setDeck(id, {
        loading: false,
        duration: duration || 0,
        baseBPM: track.bpm || 120,
        cuePoint: 0,
        currentTime: 0,
        hotCues: Array(8).fill(null),
        loop: { in: null, out: null, enabled: false, beats: null },
      });
    } catch (err) {
      console.error("load error", err);
      setDeck(id, { loading: false });
      toast.error("Track load failed", { description: err.message || "Could not decode audio." });
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
    const file = e.dataTransfer.files?.[0]; if (!file) return;
    loadTrack(await trackFromFile(file, "drop"));
  };

  // listen to dj:load
  useEffect(() => {
    const h = (ev) => { if (ev.detail?.deckId === id) loadTrack(ev.detail.track); };
    window.addEventListener("dj:load", h);
    return () => window.removeEventListener("dj:load", h);
  }, [id, loadTrack]);

  // Play/Pause/Cue
  const play = async () => {
    if (!deck.track) { toast.error("Load a track first", { description: `Deck ${label} is empty.` }); return; }
    await resumeAudioContext();
    const p = playerRef.current;
    if (!p || !p.isLoaded()) { toast.error("Track still loading"); return; }
    try {
      p.play();
      setDeck(id, { playing: true });
    } catch (e) {
      console.error("play failed", e);
      toast.error("Playback failed", { description: e.message || "Buffer player refused to start." });
    }
  };
  const pause = () => {
    playerRef.current?.pause();
    setDeck(id, { playing: false });
  };
  const togglePlay = () => (deck.playing ? pause() : play());
  const cue = () => {
    const p = playerRef.current;
    if (!p) return;
    p.seek(deck.cuePoint || 0);
    setDeck(id, { currentTime: deck.cuePoint || 0 });
    if (!deck.playing) play();
  };
  const setCueHere = () => setDeck(id, { cuePoint: playerRef.current?.getCurrentTime() || 0 });

  const sync = () => {
    if (!otherDeck?.track || !deck.baseBPM) return;
    const otherCurrent = otherDeck.currentBPM;
    if (!otherCurrent) return;
    const desiredPct = (otherCurrent / deck.baseBPM - 1) * 100;
    const clamp = Math.max(-deck.tempoRange, Math.min(deck.tempoRange, desiredPct));
    setDeck(id, { tempoPct: clamp });
  };

  const toggleTempoRange = () => setDeck(id, { tempoRange: deck.tempoRange === 8 ? 16 : 8 });

  // Beat flash from analyser
  useEffect(() => {
    const c = chainRef.current; if (!c) return;
    const analyser = c.analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let lastFlash = 0;
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (deck.playing && rms > 0.18 && now - lastFlash > 180) {
        setBeatFlash(true); lastFlash = now;
        setTimeout(() => setBeatFlash(false), 90);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [deck.playing]);

  // MIDI / keyboard actions
  useEffect(() => {
    const doAction = (action, value) => {
      const prefix = `${id}.`;
      if (!action.startsWith(prefix)) return;
      const sub = action.slice(prefix.length);
      if (sub === "play")   togglePlay();
      else if (sub === "cue") cue();
      else if (sub === "sync") sync();
      else if (sub === "pfl") setPfl(id, !deck.pflOn);
      else if (sub === "jog") {
        // MIDI jog wheel: seek by ticks * JOG_SEC_PER_TICK. Clamp to track bounds.
        const p = playerRef.current; if (!p) return;
        const duration = p.getDuration();
        const cur = p.getCurrentTime();
        const next = Math.max(0, Math.min((duration || 0) - 0.05, cur + value * JOG_SEC_PER_TICK));
        try { p.seek(next); } catch { /* noop */ }
        setDeck(id, { currentTime: next });
        // Brief visual pulse on the platter
        setJogPulse((jp) => jp + value * 0.12);
        if (jogPulseTimer.current) clearTimeout(jogPulseTimer.current);
        jogPulseTimer.current = setTimeout(() => setJogPulse(0), 220);
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
    const mh = (e) => doAction(e.detail.action, e.detail.value);
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

  const currentBPM = deck.baseBPM ? (deck.baseBPM * (1 + deck.tempoPct / 100)).toFixed(1) : "—";

  return (
    <div
      data-testid={`deck-${letter}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="relative flex flex-col gap-2 bg-[#141414]/80 backdrop-blur-xl border border-white/10 p-3 rounded-lg"
    >
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
            <span className="font-mono-dj text-[10px] text-[#A1A1AA]">
              {formatTime(deck.currentTime)} / {formatTime(deck.duration)}
            </span>
            <div className="flex items-center gap-1.5">
              <div className="label-tiny">BPM</div>
              <div className="font-mono-dj font-bold text-base leading-none" style={{ color: accent }} data-testid={`deck-${letter}-bpm`}>
                {currentBPM}
              </div>
              <input
                type="number" value={deck.baseBPM}
                onChange={(e) => setDeck(id, { baseBPM: Math.max(40, Math.min(220, +e.target.value || 120)) })}
                className="w-11 bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[10px] font-mono-dj text-white text-center focus:outline-none focus:border-[#D10A0A]"
                data-testid={`deck-${letter}-base-bpm`} title="Base BPM"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Waveform — scrolling with centered playhead */}
      <div className="relative rounded overflow-hidden border border-white/10"
           style={{
             background:
               // Subtle vertical beat-grid lines + dark gradient
               "repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 40px), " +
               "linear-gradient(180deg, #050505 0%, #0b0b0b 50%, #050505 100%)",
           }}>
        <div ref={waveRef} data-testid={`deck-${letter}-waveform`} className="h-[80px]" />
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
            onClick={() => toast.message("Keylock not available in buffer-player mode", {
              description: "Pitch follows tempo in high-fidelity playback. Re-enable coming in a future build.",
            })}
            data-testid={`deck-${letter}-keylock`}
            title="Keylock — not available in buffer-player mode"
            disabled
            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-[0.1em] border border-white/10 text-[#52525B] line-through cursor-not-allowed"
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
              {deck.tempoPct > 0 ? "+" : ""}{deck.tempoPct.toFixed(1)}%
            </span>
          </div>
          <button data-testid={`deck-${letter}-sync`} onClick={sync}
            disabled={!otherDeck?.track || !deck.track}
            className="px-2 py-1 rounded border border-white/20 bg-transparent text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-[#D10A0A]/20 hover:border-[#D10A0A] hover:text-[#FF1F1F] transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            Sync
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
