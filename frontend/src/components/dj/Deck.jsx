import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, SkipBack, Upload } from "lucide-react";
import SpinningVinyl from "./SpinningVinyl";
import EQKnob from "./EQKnob";
import { useDJStore } from "@/store/djStore";
import { createDeckChain, resumeAudioContext } from "@/lib/audioEngine";
import { toast } from "sonner";

const formatTime = (s) => {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export default function Deck({ id, label, accent }) {
  const waveRef = useRef(null);
  const audioElRef = useRef(null);
  const wsRef = useRef(null);
  const chainRef = useRef(null);
  const rafRef = useRef(null);

  const deck = useDJStore((s) => s[id]);
  const otherDeck = useDJStore((s) => (id === "deckA" ? s.deckB : s.deckA));
  const setDeck = useDJStore((s) => s.setDeck);
  const setDeckEQ = useDJStore((s) => s.setDeckEQ);

  const [beatFlash, setBeatFlash] = useState(false);

  // Init audio element + chain (once)
  useEffect(() => {
    const el = new Audio();
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    audioElRef.current = el;

    // Chain must be created AFTER user gesture ideally, but MediaElementSource
    // can be created anytime; the AudioContext will resume on first play.
    try {
      chainRef.current = createDeckChain(el);
      // Notify parent so Mixer can control crossfade gains
      window.dispatchEvent(
        new CustomEvent("dj:chain-ready", { detail: { deckId: id, chain: chainRef.current } })
      );
    } catch (err) {
      console.error("deck chain error", err);
    }

    el.addEventListener("ended", () => setDeck(id, { playing: false }));
    el.addEventListener("loadedmetadata", () => {
      setDeck(id, { duration: el.duration || 0 });
    });
    el.addEventListener("timeupdate", () => {
      setDeck(id, { currentTime: el.currentTime || 0 });
    });

    return () => {
      el.pause();
      el.src = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wavesurfer — bound to our audio element so our audio graph stays the single source of truth
  useEffect(() => {
    if (!waveRef.current || !audioElRef.current) return;
    const ws = WaveSurfer.create({
      container: waveRef.current,
      waveColor: "rgba(198, 40, 0, 0.55)",
      progressColor: accent || "#FF3B00",
      cursorColor: "#FFFFFF",
      cursorWidth: 2,
      barWidth: 2,
      barRadius: 2,
      barGap: 2,
      height: 96,
      normalize: true,
      media: audioElRef.current, // use our element → our Web Audio chain
      interact: true,
    });
    wsRef.current = ws;
    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [accent]);

  // Apply EQ changes
  useEffect(() => {
    if (!chainRef.current) return;
    chainRef.current.setLow(deck.eq.low);
    chainRef.current.setMid(deck.eq.mid);
    chainRef.current.setHigh(deck.eq.high);
  }, [deck.eq.low, deck.eq.mid, deck.eq.high]);

  // Apply volume
  useEffect(() => {
    if (!chainRef.current) return;
    chainRef.current.setVolume(deck.volume);
  }, [deck.volume]);

  // Apply tempo (playback rate)
  useEffect(() => {
    if (!audioElRef.current) return;
    const rate = 1 + deck.tempoPct / 100;
    audioElRef.current.playbackRate = rate;
    audioElRef.current.preservesPitch = false;
  }, [deck.tempoPct]);

  // Load track
  const loadTrack = useCallback(async (track) => {
    if (!track) return;
    setDeck(id, { loading: true, track, playing: false });
    const el = audioElRef.current;
    try {
      let playUrl = track.url;
      if (!playUrl && track.source === "s3") {
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks/url?key=${encodeURIComponent(track.key)}`);
        const data = await res.json();
        playUrl = data.url;
      } else if (track.source === "demo") {
        // Always resolve through /api/tracks/url to get the CORS-safe proxy URL
        const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks/url?key=${encodeURIComponent(track.key)}`);
        const data = await res.json();
        // data.url is a relative /api/tracks/stream?key=... path → prefix with backend
        playUrl = data.url.startsWith("http") ? data.url : `${process.env.REACT_APP_BACKEND_URL}${data.url}`;
      }
      el.src = playUrl;
      el.load();
      if (wsRef.current) {
        // Wavesurfer will re-render waveform from the element; force load for peaks
        await wsRef.current.load(playUrl).catch(() => {});
      }
      setDeck(id, {
        loading: false,
        baseBPM: track.bpm || 120,
        cuePoint: 0,
        currentTime: 0,
      });
    } catch (err) {
      console.error("load error", err);
      setDeck(id, { loading: false });
    }
  }, [id, setDeck]);

  // Upload local file
  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadTrack({
      key: `local-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ""),
      artist: "Local",
      url,
      bpm: 120,
      source: "local",
    });
  };

  // Drag-drop
  const onDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadTrack({
      key: `drop-${Date.now()}`,
      name: file.name.replace(/\.[^.]+$/, ""),
      artist: "Local",
      url,
      bpm: 120,
      source: "local",
    });
  };

  // Expose loadTrack to window for DJLab to dispatch (via custom event)
  useEffect(() => {
    const handler = (ev) => {
      if (ev.detail?.deckId === id) loadTrack(ev.detail.track);
    };
    window.addEventListener("dj:load", handler);
    return () => window.removeEventListener("dj:load", handler);
  }, [id, loadTrack]);

  // Play/Pause/Cue
  const play = async () => {
    if (!deck.track) {
      toast.error("Load a track first", { description: `Deck ${label} is empty.` });
      return;
    }
    await resumeAudioContext();
    try {
      await audioElRef.current.play();
      setDeck(id, { playing: true });
    } catch (e) {
      console.error("play failed", e);
      toast.error("Playback failed", { description: e.message || "Audio element refused to start." });
    }
  };
  const pause = () => {
    audioElRef.current.pause();
    setDeck(id, { playing: false });
  };
  const togglePlay = () => (deck.playing ? pause() : play());
  const cue = () => {
    audioElRef.current.currentTime = deck.cuePoint || 0;
    if (!deck.playing) play();
  };
  const setCueHere = () => {
    setDeck(id, { cuePoint: audioElRef.current.currentTime });
  };

  // Sync → match this deck's current BPM to the other deck's current BPM
  const sync = () => {
    if (!otherDeck?.track || !otherDeck.baseBPM || !deck.baseBPM) return;
    const otherCurrent = otherDeck.baseBPM * (1 + otherDeck.tempoPct / 100);
    const desiredPct = (otherCurrent / deck.baseBPM - 1) * 100;
    const clamp = Math.max(-deck.tempoRange, Math.min(deck.tempoRange, desiredPct));
    setDeck(id, { tempoPct: clamp });
  };

  const toggleTempoRange = () => {
    setDeck(id, { tempoRange: deck.tempoRange === 8 ? 16 : 8 });
  };

  // Beat-flash from analyser: measure RMS and flash on transients
  useEffect(() => {
    if (!chainRef.current) return;
    const analyser = chainRef.current.analyser;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let lastFlash = 0;
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (deck.playing && rms > 0.18 && now - lastFlash > 180) {
        setBeatFlash(true);
        lastFlash = now;
        setTimeout(() => setBeatFlash(false), 90);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [deck.playing]);

  const currentBPM = deck.baseBPM ? (deck.baseBPM * (1 + deck.tempoPct / 100)).toFixed(1) : "—";

  return (
    <div
      data-testid={`deck-${id === "deckA" ? "a" : "b"}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="relative flex flex-col gap-4 bg-[#141414]/80 backdrop-blur-xl border border-white/10 p-5 rounded-lg overflow-hidden"
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

      {/* Top row: vinyl + track info */}
      <div className="flex items-center gap-5 relative">
        <SpinningVinyl
          spinning={deck.playing}
          label={label}
          size={140}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="label-tiny" style={{ color: accent }}>DECK {label}</span>
            <span className="label-tiny">{deck.track?.source || "—"}</span>
          </div>
          <div className="font-display font-bold text-lg truncate" data-testid={`deck-${id === "deckA" ? "a" : "b"}-title`}>
            {deck.track?.name || "No track loaded"}
          </div>
          <div className="text-xs text-[#A1A1AA] truncate">
            {deck.track?.artist || "Drag & drop or pick from library"}
          </div>

          {/* Time */}
          <div className="mt-3 flex items-baseline gap-3">
            <span className="font-mono-dj text-xs text-[#A1A1AA]">
              {formatTime(deck.currentTime)} / {formatTime(deck.duration)}
            </span>
          </div>

          {/* BPM */}
          <div className="mt-2 flex items-center gap-3">
            <div>
              <div className="label-tiny">BPM</div>
              <div
                className="font-mono-dj font-bold text-2xl"
                style={{ color: accent }}
                data-testid={`deck-${id === "deckA" ? "a" : "b"}-bpm`}
              >
                {currentBPM}
              </div>
            </div>
            <input
              type="number"
              value={deck.baseBPM}
              onChange={(e) => setDeck(id, { baseBPM: Math.max(40, Math.min(220, +e.target.value || 120)) })}
              className="w-16 bg-black/60 border border-white/10 rounded px-2 py-1 text-xs font-mono-dj text-white text-center focus:outline-none focus:border-[#C62800]"
              data-testid={`deck-${id === "deckA" ? "a" : "b"}-base-bpm`}
              title="Base BPM"
            />
          </div>
        </div>
      </div>

      {/* Waveform */}
      <div className="relative bg-black/40 border border-white/5 rounded p-2">
        <div ref={waveRef} data-testid={`deck-${id === "deckA" ? "a" : "b"}-waveform`} />
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-4">
        {/* Play + Cue */}
        <div className="flex items-center gap-2">
          <button
            data-testid={`deck-${id === "deckA" ? "a" : "b"}-cue`}
            onClick={cue}
            onDoubleClick={setCueHere}
            title="Cue (dbl-click to set cue point)"
            className="w-12 h-12 rounded-full border border-white/20 hover:border-[#FF3B00] hover:shadow-[0_0_15px_#FF3B00] transition-all flex items-center justify-center bg-[#0a0a0a]"
          >
            <SkipBack className="w-4 h-4 text-white" />
          </button>
          <button
            data-testid={`deck-${id === "deckA" ? "a" : "b"}-play`}
            onClick={togglePlay}
            disabled={!deck.track}
            className={`w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all ${
              deck.playing
                ? "bg-[#C62800] border-[#FF3B00] shadow-[0_0_24px_#FF3B00]"
                : "border-white/20 hover:border-[#FF3B00] hover:shadow-[0_0_15px_#FF3B00]"
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {deck.playing ? <Pause className="w-6 h-6 text-white" fill="currentColor" /> : <Play className="w-6 h-6 text-white ml-1" fill="currentColor" />}
          </button>
        </div>

        {/* EQ */}
        <div className="flex items-center gap-2 ml-2 pl-4 border-l border-white/10">
          <EQKnob
            label="HI"
            value={deck.eq.high}
            onChange={(v) => setDeckEQ(id, "high", v)}
            testid={`deck-${id === "deckA" ? "a" : "b"}-eq-high`}
            color={accent}
          />
          <EQKnob
            label="MID"
            value={deck.eq.mid}
            onChange={(v) => setDeckEQ(id, "mid", v)}
            testid={`deck-${id === "deckA" ? "a" : "b"}-eq-mid`}
            color={accent}
          />
          <EQKnob
            label="LOW"
            value={deck.eq.low}
            onChange={(v) => setDeckEQ(id, "low", v)}
            testid={`deck-${id === "deckA" ? "a" : "b"}-eq-low`}
            color={accent}
          />
        </div>

        {/* Volume fader */}
        <div className="flex flex-col items-center ml-auto">
          <span className="label-tiny mb-1">VOL</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={deck.volume}
            onChange={(e) => setDeck(id, { volume: +e.target.value })}
            className="fader-vert"
            style={{ height: 140 }}
            data-testid={`deck-${id === "deckA" ? "a" : "b"}-volume`}
          />
        </div>

        {/* Tempo */}
        <div className="flex flex-col items-center">
          <span className="label-tiny mb-1">TEMPO ±{deck.tempoRange}%</span>
          <input
            type="range"
            min={-deck.tempoRange}
            max={deck.tempoRange}
            step={0.1}
            value={deck.tempoPct}
            onChange={(e) => setDeck(id, { tempoPct: +e.target.value })}
            className="tempo-slider"
            data-testid={`deck-${id === "deckA" ? "a" : "b"}-tempo`}
          />
          <span className="font-mono-dj text-[10px] text-[#A1A1AA] mt-1">
            {deck.tempoPct > 0 ? "+" : ""}{deck.tempoPct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Bottom row: Sync + range toggle + upload */}
      <div className="flex items-center gap-2">
        <button
          data-testid={`deck-${id === "deckA" ? "a" : "b"}-sync`}
          onClick={sync}
          disabled={!otherDeck?.track || !deck.track}
          className="px-4 py-2 rounded border border-white/20 bg-transparent text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-[#C62800]/20 hover:border-[#C62800] hover:text-[#FF3B00] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Sync
        </button>
        <button
          data-testid={`deck-${id === "deckA" ? "a" : "b"}-tempo-range`}
          onClick={toggleTempoRange}
          className="px-3 py-2 rounded border border-white/10 bg-transparent text-[10px] font-bold uppercase tracking-[0.2em] text-[#A1A1AA] hover:text-white hover:border-white/30 transition-all"
        >
          ±{deck.tempoRange === 8 ? "16" : "8"}%
        </button>
        <label className="ml-auto px-3 py-2 rounded border border-white/10 text-[10px] font-bold uppercase tracking-[0.2em] text-[#A1A1AA] hover:text-white hover:border-white/30 cursor-pointer flex items-center gap-2"
          data-testid={`deck-${id === "deckA" ? "a" : "b"}-upload`}
        >
          <Upload className="w-3 h-3" />
          Load file
          <input type="file" accept="audio/*" className="hidden" onChange={onFile} />
        </label>
      </div>
    </div>
  );
}
