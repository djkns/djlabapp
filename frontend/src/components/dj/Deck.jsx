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

  // Wavesurfer
  useEffect(() => {
    if (!waveRef.current || !audioElRef.current) return;
    const ws = WaveSurfer.create({
      container: waveRef.current,
      waveColor: "rgba(209, 10, 10, 0.55)",
      progressColor: accent || "#FF1F1F",
      cursorColor: "#FFFFFF",
      cursorWidth: 2,
      barWidth: 2,
      barRadius: 2,
      barGap: 2,
      height: 96,
      normalize: true,
      media: audioElRef.current,
      interact: true,
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

  // Tempo (playback rate)
  useEffect(() => {
    const el = audioElRef.current; if (!el) return;
    el.playbackRate = 1 + deck.tempoPct / 100;
    el.preservesPitch = false;
  }, [deck.tempoPct]);

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
      className="relative flex flex-col gap-3 bg-[#141414]/80 backdrop-blur-xl border border-white/10 p-4 rounded-lg"
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
      <div className="flex items-center gap-4 relative">
        <SpinningVinyl
          spinning={deck.playing}
          label={label}
          size={120}
          cover={deck.track?.cover || null}
          onScratchStart={onScratchStart}
          onScratchMove={onScratchMove}
          onScratchEnd={onScratchEnd}
          externalAngle={jogPulse}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="label-tiny" style={{ color: accent }}>DECK {label}</span>
            <span className="label-tiny">{deck.track?.source || "—"}</span>
            {deck.track?.year && <span className="label-tiny">· {deck.track.year}</span>}
            {deck.track?.genre && <span className="label-tiny truncate max-w-[90px]">· {deck.track.genre}</span>}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            {deck.track?.cover && (
              <img src={deck.track.cover} alt="" data-testid={`deck-${letter}-cover`}
                   className="w-10 h-10 rounded object-cover shrink-0 border border-white/10 shadow-lg" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-display font-bold text-base truncate" data-testid={`deck-${letter}-title`}>
                {deck.track?.name || "No track loaded"}
              </div>
              <div className="text-xs text-[#A1A1AA] truncate" data-testid={`deck-${letter}-artist`}>
                {deck.track ? (deck.track.artist || "Unknown artist") : "Drag & drop or pick from library"}
              </div>
              {deck.track?.album && (
                <div className="text-[10px] text-[#52525B] truncate italic" data-testid={`deck-${letter}-album`}>
                  {deck.track.album}
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="font-mono-dj text-xs text-[#A1A1AA]">
              {formatTime(deck.currentTime)} / {formatTime(deck.duration)}
            </span>
            <div className="flex items-center gap-2">
              <div>
                <div className="label-tiny">BPM</div>
                <div className="font-mono-dj font-bold text-xl" style={{ color: accent }} data-testid={`deck-${letter}-bpm`}>
                  {currentBPM}
                </div>
              </div>
              <input
                type="number" value={deck.baseBPM}
                onChange={(e) => setDeck(id, { baseBPM: Math.max(40, Math.min(220, +e.target.value || 120)) })}
                className="w-14 bg-black/60 border border-white/10 rounded px-2 py-1 text-[11px] font-mono-dj text-white text-center focus:outline-none focus:border-[#D10A0A]"
                data-testid={`deck-${letter}-base-bpm`} title="Base BPM"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Waveform */}
      <div className="relative bg-black/40 border border-white/5 rounded p-2">
        <div ref={waveRef} data-testid={`deck-${letter}-waveform`} />
        {/* Loop overlay markers would go here in v2 */}
      </div>

      {/* Controls row 1 — Transport | EQ | Vol | Tempo (always fits ~500px) */}
      <div className="flex items-start gap-3 flex-wrap">
        {/* Transport */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            data-testid={`deck-${letter}-cue`}
            onClick={cue} onDoubleClick={setCueHere}
            title="Cue (dbl-click to set cue point)"
            className="w-11 h-11 rounded-full border border-white/20 hover:border-[#FF1F1F] hover:shadow-[0_0_15px_#FF1F1F] transition-all flex items-center justify-center bg-[#0a0a0a]"
          >
            <SkipBack className="w-3.5 h-3.5 text-white" />
          </button>
          <button
            data-testid={`deck-${letter}-play`}
            onClick={togglePlay} disabled={!deck.track}
            className={`w-14 h-14 rounded-full border-2 flex items-center justify-center transition-all ${
              deck.playing
                ? "bg-[#D10A0A] border-[#FF1F1F] shadow-[0_0_24px_#FF1F1F]"
                : "border-white/20 hover:border-[#FF1F1F] hover:shadow-[0_0_15px_#FF1F1F]"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {deck.playing ? <Pause className="w-5 h-5 text-white" fill="currentColor" /> : <Play className="w-5 h-5 text-white ml-0.5" fill="currentColor" />}
          </button>
          <button
            data-testid={`deck-${letter}-pfl`}
            onClick={() => setPfl(id, !deck.pflOn)}
            title="Headphone Cue (PFL)"
            className={`w-11 h-11 rounded-full border flex items-center justify-center transition-all ${
              deck.pflOn
                ? "bg-[#D10A0A] border-[#FF1F1F] text-white shadow-[0_0_14px_#FF1F1F]"
                : "border-white/20 text-[#A1A1AA] hover:border-white/50 hover:text-white"
            }`}
          >
            <Headphones className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* EQ */}
        <div className="flex items-center gap-1 pl-2 border-l border-white/10 shrink-0">
          <EQKnob label="HI"  value={deck.eq.high} onChange={(v) => setDeckEQ(id, "high", v)} testid={`deck-${letter}-eq-high`} color={accent} />
          <EQKnob label="MID" value={deck.eq.mid}  onChange={(v) => setDeckEQ(id, "mid",  v)} testid={`deck-${letter}-eq-mid`}  color={accent} />
          <EQKnob label="LOW" value={deck.eq.low}  onChange={(v) => setDeckEQ(id, "low",  v)} testid={`deck-${letter}-eq-low`}  color={accent} />
        </div>

        {/* Vol (horizontal, compact) */}
        <div className="flex flex-col gap-1 min-w-[100px] flex-1 pl-2 border-l border-white/10">
          <span className="label-tiny">VOL</span>
          <input type="range" min={0} max={1} step={0.01} value={deck.volume}
            onChange={(e) => setDeck(id, { volume: +e.target.value })}
            className="w-full accent-[#D10A0A]"
            data-testid={`deck-${letter}-volume`} />
          <span className="label-tiny">TEMPO ±{deck.tempoRange}%</span>
          <input type="range" min={-deck.tempoRange} max={deck.tempoRange} step={0.1} value={deck.tempoPct}
            onChange={(e) => setDeck(id, { tempoPct: +e.target.value })}
            className="w-full accent-[#FF1F1F]"
            data-testid={`deck-${letter}-tempo`} />
          <span className="font-mono-dj text-[10px] text-[#A1A1AA] text-right -mt-0.5">
            {deck.tempoPct > 0 ? "+" : ""}{deck.tempoPct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Controls row 2 — Hot cues + Loop (full deck width) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <HotCuePad deckId={id} deckLetter={letter} getCurrentTime={getCurrentTime} seekTo={seekTo} />
        <LoopControls deckId={id} deckLetter={letter} getCurrentTime={getCurrentTime} seekTo={seekTo} />
      </div>

      {/* Bottom: Sync, range, upload */}
      <div className="flex items-center gap-2">
        <button data-testid={`deck-${letter}-sync`} onClick={sync}
          disabled={!otherDeck?.track || !deck.track}
          className="px-4 py-2 rounded border border-white/20 bg-transparent text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-[#D10A0A]/20 hover:border-[#D10A0A] hover:text-[#FF1F1F] transition-all disabled:opacity-40 disabled:cursor-not-allowed">
          Sync
        </button>
        <button data-testid={`deck-${letter}-tempo-range`} onClick={toggleTempoRange}
          className="px-3 py-2 rounded border border-white/10 bg-transparent text-[10px] font-bold uppercase tracking-[0.2em] text-[#A1A1AA] hover:text-white hover:border-white/30">
          ±{deck.tempoRange === 8 ? "16" : "8"}%
        </button>
        <label className="ml-auto px-3 py-2 rounded border border-white/10 text-[10px] font-bold uppercase tracking-[0.2em] text-[#A1A1AA] hover:text-white hover:border-white/30 cursor-pointer flex items-center gap-2"
          data-testid={`deck-${letter}-upload`}>
          <Upload className="w-3 h-3" />
          Load file
          <input type="file" accept="audio/*" className="hidden" onChange={onFile} />
        </label>
      </div>
    </div>
  );
}
