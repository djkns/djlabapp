import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, SkipBack, Upload, Headphones } from "lucide-react";
import SpinningVinyl from "./SpinningVinyl";
import EQKnob from "./EQKnob";
import HotCuePad from "./HotCuePad";
import LoopControls from "./LoopControls";
import { useDJStore } from "@/store/djStore";
import { createDeckChain, resumeAudioContext } from "@/lib/audioEngine";
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
  const audioElRef = useRef(null);
  const wsRef = useRef(null);
  const chainRef = useRef(null);
  const rafRef = useRef(null);

  const deck = useDJStore((s) => s[id]);
  const otherDeck = useDJStore((s) => (id === "deckA" ? s.deckB : s.deckA));
  const setDeck = useDJStore((s) => s.setDeck);
  const setDeckEQ = useDJStore((s) => s.setDeckEQ);
  const setHotCue = useDJStore((s) => s.setHotCue);
  const setPfl = useDJStore((s) => s.setPfl);

  const [beatFlash, setBeatFlash] = useState(false);

  // Audio element + chain
  useEffect(() => {
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    audioElRef.current = el;

    try {
      chainRef.current = createDeckChain(el);
      window.dispatchEvent(new CustomEvent("dj:chain-ready", { detail: { deckId: id, chain: chainRef.current } }));
    } catch (err) { console.error("deck chain error", err); }

    el.addEventListener("ended", () => setDeck(id, { playing: false }));
    el.addEventListener("loadedmetadata", () => setDeck(id, { duration: el.duration || 0 }));
    el.addEventListener("timeupdate", () => {
      const t = el.currentTime || 0;
      // Loop behaviour
      const s = useDJStore.getState()[id];
      if (s.loop?.enabled && s.loop.in != null && s.loop.out != null && t >= s.loop.out) {
        el.currentTime = s.loop.in;
        setDeck(id, { currentTime: s.loop.in });
        return;
      }
      setDeck(id, { currentTime: t });
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
      cursorColor: "transparent",      // we render our own centered playhead
      cursorWidth: 0,
      barWidth: 2,
      barRadius: 2,
      barGap: 1,
      height: 80,
      normalize: true,
      media: audioElRef.current,
      interact: true,
      autoScroll: true,               // scrolls past the cursor as it plays
      autoCenter: true,               // keeps playhead in the center
      minPxPerSec: 120,               // zoom: ~10s window
      hideScrollbar: true,
      fillParent: false,
    });
    wsRef.current = ws;
    return () => { ws.destroy(); wsRef.current = null; };
  }, [accent]);

  // EQ
  useEffect(() => {
    const c = chainRef.current; if (!c) return;
    c.setLow(deck.eq.low); c.setMid(deck.eq.mid); c.setHigh(deck.eq.high);
  }, [deck.eq.low, deck.eq.mid, deck.eq.high]);

  // Volume
  useEffect(() => { chainRef.current?.setVolume(deck.volume); }, [deck.volume]);

  // PFL / headphone cue on this deck
  useEffect(() => { chainRef.current?.setCueActive(!!deck.pflOn); }, [deck.pflOn]);

  // Tempo (playback rate) + keylock
  useEffect(() => {
    const el = audioElRef.current; if (!el) return;
    el.playbackRate = 1 + deck.tempoPct / 100;
    el.preservesPitch = deck.keylock;
  }, [deck.tempoPct, deck.keylock]);

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
      if (wsRef.current) { await wsRef.current.load(playUrl).catch(() => {}); }
      setDeck(id, { loading: false, baseBPM: track.bpm || 120, cuePoint: 0, currentTime: 0, hotCues: Array(8).fill(null), loop: { in: null, out: null, enabled: false, beats: null } });
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

  const sync = () => {
    if (!otherDeck?.track || !otherDeck.baseBPM || !deck.baseBPM) return;
    const otherCurrent = otherDeck.baseBPM * (1 + otherDeck.tempoPct / 100);
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
        const el = audioElRef.current; if (!el) return;
        const next = Math.max(0, Math.min((el.duration || 0) - 0.05, (el.currentTime || 0) + value * JOG_SEC_PER_TICK));
        try { el.currentTime = next; } catch { /* noop */ }
        setDeck(id, { currentTime: next });
        // Brief visual pulse on the platter
        setJogPulse((p) => p + value * 0.12);
        if (jogPulseTimer.current) clearTimeout(jogPulseTimer.current);
        jogPulseTimer.current = setTimeout(() => setJogPulse(0), 220);
      }
      else if (sub === "volume")  setDeck(id, { volume: value });
      else if (sub === "tempo")   setDeck(id, { tempoPct: Math.max(-deck.tempoRange, Math.min(deck.tempoRange, value * deck.tempoRange)) });
      else if (sub === "trim")    setDeck(id, { trim: Math.max(-12, Math.min(12, value)) });
      else if (sub === "filter")  setDeck(id, { filter: Math.max(-1, Math.min(1, value)) });
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

      {/* Controls row 2 — Hot cues + Loop (always 2 cols) */}
      <div className="grid grid-cols-2 gap-2">
        <HotCuePad deckId={id} deckLetter={letter} getCurrentTime={getCurrentTime} seekTo={seekTo} />
        <LoopControls deckId={id} deckLetter={letter} getCurrentTime={getCurrentTime} seekTo={seekTo} />
      </div>
    </div>
  );
}
