import { useEffect, useRef, useState } from "react";
import { Mic, Square, Download, FolderOpen, Gamepad2, Headphones as HpIcon } from "lucide-react";
import { useDJStore } from "@/store/djStore";
import {
  getAudioContext, resumeAudioContext,
  startMasterRecording, stopMasterRecording, crossfadeGains,
} from "@/lib/audioEngine";
import { toast } from "sonner";
import EQKnob from "./EQKnob";
import HeadphoneSection from "./HeadphoneSection";

// Thin vertical stereo VU bar driven by a deck's analyser
function ChannelVU({ analyser }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let raf;
    const loop = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      setLevel(Math.sqrt(sum / buf.length));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);
  const fill = Math.min(1, level * 3);
  return (
    <div className="w-2 h-16 bg-[#0c0c0c] rounded overflow-hidden flex flex-col-reverse border border-white/5">
      <div className="w-full" style={{
        height: `${fill * 100}%`,
        background: "linear-gradient(to top, #22c55e 0%, #22c55e 55%, #eab308 75%, #FF1F1F 95%)",
        transition: "height 40ms linear",
      }} />
    </div>
  );
}

// Channel strip: Gain → EQ(HIGH/MID/LOW) → Filter → Tempo (vert) → VU + Volume fader
function ChannelStrip({ deckId, deckLabel, chain }) {
  const deck = useDJStore((s) => s[deckId]);
  const setDeck = useDJStore((s) => s.setDeck);
  const setDeckEQ = useDJStore((s) => s.setDeckEQ);
  const letter = deckId === "deckA" ? "a" : "b";

  useEffect(() => { chain?.setTrim?.(deck.trim); }, [chain, deck.trim]);
  useEffect(() => { chain?.setFilter?.(deck.filter); }, [chain, deck.filter]);

  return (
    <div className="flex flex-col items-center gap-1 px-1.5" data-testid={`channel-strip-${letter}`}>
      <span className="label-tiny" style={{ color: "#FF1F1F" }}>DECK {deckLabel}</span>

      {/* Knobs + Tempo vertical fader side-by-side */}
      <div className="flex gap-2 items-start">
        {/* Knob column */}
        <div className="flex flex-col items-center gap-1">
          <EQKnob label="GAIN" value={deck.trim} min={-12} max={12}
            onChange={(v) => setDeck(deckId, { trim: v })}
            testid={`channel-${letter}-trim`} />
          <EQKnob label="HIGH" value={deck.eq.high} onChange={(v) => setDeckEQ(deckId, "high", v)} testid={`channel-${letter}-eq-high`} />
          <EQKnob label="MID"  value={deck.eq.mid}  onChange={(v) => setDeckEQ(deckId, "mid",  v)} testid={`channel-${letter}-eq-mid`} />
          <EQKnob label="LOW"  value={deck.eq.low}  onChange={(v) => setDeckEQ(deckId, "low",  v)} testid={`channel-${letter}-eq-low`} />
          <EQKnob label="FILTER" value={deck.filter} min={-1} max={1}
            onChange={(v) => setDeck(deckId, { filter: v })}
            testid={`channel-${letter}-filter`}
            color="#FF9500"
          />
        </div>

        {/* Tempo / Pitch fader column */}
        <div className="flex flex-col items-center gap-1 pt-2">
          <span className="label-tiny">TEMPO</span>
          <span className="font-mono-dj text-[9px] text-[#A1A1AA]" data-testid={`channel-${letter}-tempo-readout`}>
            {deck.tempoPct > 0 ? "+" : ""}{deck.tempoPct.toFixed(1)}%
          </span>
          <input
            type="range"
            min={-deck.tempoRange} max={deck.tempoRange} step={0.1}
            value={deck.tempoPct}
            onChange={(e) => setDeck(deckId, { tempoPct: +e.target.value })}
            onDoubleClick={() => setDeck(deckId, { tempoPct: 0 })}
            className="fader-vert"
            style={{ height: 300 }}
            data-testid={`channel-${letter}-tempo`}
            title="Double-click to reset"
          />
          <span className="label-tiny">±{deck.tempoRange}%</span>
        </div>
      </div>

      {/* VU + Volume */}
      <div className="flex items-end gap-1 mt-1">
        <ChannelVU analyser={chain?.analyser} />
        <input type="range" min={0} max={1} step={0.01} value={deck.volume}
          onChange={(e) => setDeck(deckId, { volume: +e.target.value })}
          className="fader-vert" style={{ height: 110 }}
          data-testid={`channel-${letter}-volume`} />
      </div>
    </div>
  );
}

// Master VU bars (stereo)
function MasterVU({ levels }) {
  const meterFill = (v) => Math.min(1, v * 3);
  return (
    <div className="flex justify-center gap-1">
      {[0, 1].map((ch) => (
        <div key={ch} className="w-2 h-32 bg-[#0c0c0c] rounded overflow-hidden flex flex-col-reverse border border-white/5">
          <div className="w-full" style={{
            height: `${meterFill(ch === 0 ? levels.l : levels.r) * 100}%`,
            background: "linear-gradient(to top, #22c55e 0%, #22c55e 55%, #eab308 75%, #FF1F1F 95%)",
            transition: "height 40ms linear",
          }} />
        </div>
      ))}
    </div>
  );
}

export default function Mixer({ deckChains, onOpenSaveSet, onOpenSavedSets, onOpenMidi }) {
  const crossfader = useDJStore((s) => s.crossfader);
  const setCrossfader = useDJStore((s) => s.setCrossfader);
  const masterVolume = useDJStore((s) => s.masterVolume);
  const setMasterVolume = useDJStore((s) => s.setMasterVolume);
  const recording = useDJStore((s) => s.recording);
  const setRecording = useDJStore((s) => s.setRecording);
  const setHp = useDJStore((s) => s.setHp);
  const hp = useDJStore((s) => s.hp);
  const midi = useDJStore((s) => s.midi);

  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const intervalRef = useRef(null);
  const lastRecordingRef = useRef({ blob: null, duration: 0 });
  const [levels, setLevels] = useState({ l: 0, r: 0 });

  useEffect(() => {
    const { a, b } = crossfadeGains(crossfader);
    deckChains?.deckA?.setCrossfade?.(a);
    deckChains?.deckB?.setCrossfade?.(b);
  }, [crossfader, deckChains]);

  useEffect(() => {
    const { masterGain } = getAudioContext();
    masterGain.gain.value = masterVolume;
  }, [masterVolume]);

  useEffect(() => {
    const { masterAnalyser } = getAudioContext();
    const buf = new Uint8Array(masterAnalyser.frequencyBinCount);
    let raf;
    const loop = () => {
      masterAnalyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      setLevels({ l: rms, r: rms });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const start = async () => {
    await resumeAudioContext();
    elapsedRef.current = 0; setElapsed(0);
    startMasterRecording((blob, mime, durationSec) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `djlab-mix-${new Date().toISOString().replace(/[:.]/g, "-")}.${mime.includes("webm") ? "webm" : "ogg"}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      lastRecordingRef.current = { blob, duration: durationSec };
      toast.success("Mix downloaded", {
        description: `${(blob.size / 1024 / 1024).toFixed(2)} MB`,
        action: { label: "Save Set", onClick: () => onOpenSaveSet?.(durationSec) },
      });
    });
    setRecording(true);
    intervalRef.current = setInterval(() => { elapsedRef.current += 1; setElapsed(elapsedRef.current); }, 1000);
    toast.message("Recording started", { description: "Capturing the master bus." });
  };
  const stop = () => { stopMasterRecording(); setRecording(false); clearInterval(intervalRef.current); };

  useEffect(() => {
    const h = (e) => {
      const { action, value } = e.detail;
      if (action === "master.record") (recording ? stop() : start());
      else if (action === "master.volume") setMasterVolume(Math.max(0, Math.min(1.2, value * 1.2)));
      else if (action === "hp.volume") setHp({ volume: value });
      else if (action === "hp.mix") setHp({ mix: value });
      else if (action === "crossfader") setCrossfader(Math.max(-1, Math.min(1, value)));
    };
    window.addEventListener("dj:action", h);
    return () => window.removeEventListener("dj:action", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const fmt = (s) => {
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };
  const meterFill = (v) => Math.min(1, v * 3);

  return (
    <div data-testid="mixer"
      className="flex flex-col gap-2 bg-[#0a0a0a] border-x border-white/5 p-3 pb-20 items-stretch overflow-y-auto">
      {/* Top row: HP col | Deck A strip | Deck B strip | Master col */}
      <div className="flex gap-1.5 border-b border-white/5 pb-3 justify-center">
        {/* LEFT — Headphone column */}
        <div className="flex flex-col items-center gap-2 px-1 pt-[18px]" data-testid="hp-column">
          <span className="label-tiny" style={{ color: "#A1A1AA" }}>HP</span>
          <button
            data-testid="hp-toggle"
            onClick={() => setHp({ enabled: !hp.enabled })}
            className={`w-6 h-6 rounded-full flex items-center justify-center border transition-all ${
              hp.enabled
                ? "bg-[#D10A0A] border-[#FF1F1F] text-white shadow-[0_0_10px_#FF1F1F]"
                : "border-white/20 text-[#A1A1AA] hover:border-white/50"
            }`}
            title={hp.enabled ? "Disable headphones" : "Enable headphones"}
          >
            <HpIcon className="w-3 h-3" />
          </button>
          <EQKnob
            label="CUE MIX" value={hp.mix} min={0} max={1}
            onChange={(v) => setHp({ mix: Math.max(0, Math.min(1, v)) })}
            testid="hp-mix"
            color="#00D4FF"
          />
          <EQKnob
            label="HP VOL" value={hp.volume} min={0} max={1.2}
            onChange={(v) => setHp({ volume: Math.max(0, Math.min(1.2, v)) })}
            testid="hp-volume"
            color="#00D4FF"
          />
        </div>

        {/* CENTER — Channel strips */}
        <ChannelStrip deckId="deckA" deckLabel="A" chain={deckChains?.deckA} />
        <ChannelStrip deckId="deckB" deckLabel="B" chain={deckChains?.deckB} />

        {/* RIGHT — Master column */}
        <div className="flex flex-col items-center gap-2 px-1 pt-[18px]" data-testid="master-column">
          <span className="label-tiny" style={{ color: "#FF1F1F" }}>MSTR</span>
          <EQKnob
            label="MASTER" value={masterVolume} min={0} max={1.2}
            onChange={(v) => setMasterVolume(Math.max(0, Math.min(1.2, v)))}
            testid="master-volume"
            color="#FF1F1F"
          />
          <MasterVU levels={levels} />
        </div>
      </div>

      {/* Crossfader (moved up — directly under decks) */}
      <div className="pt-2 border-t border-white/5">
        <div className="flex justify-between items-center mb-1 px-1">
          <span className="label-tiny" style={{ color: "#FF1F1F" }}>A</span>
          <span className="label-tiny">CROSSFADER</span>
          <span className="label-tiny" style={{ color: "#FF1F1F" }}>B</span>
        </div>
        <div className="relative">
          <div className="absolute inset-0 rounded-full pointer-events-none cf-trail"
            style={{ opacity: 0.9, transform: `translateX(${crossfader * 20}%)`, transition: "transform 80ms ease-out" }} />
          <input type="range" min={-1} max={1} step={0.01} value={crossfader}
            onChange={(e) => setCrossfader(+e.target.value)}
            onDoubleClick={() => setCrossfader(0)}
            className="fader-horiz w-full" data-testid="crossfader" />
        </div>
      </div>

      {/* Record + Save Set + MIDI (moved below crossfader) */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-white/5">
        <button data-testid="record-toggle" onClick={recording ? stop : start}
          className={`w-full px-3 py-2 rounded border-2 text-[10px] font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all ${
            recording
              ? "border-[#FF1F1F] bg-[#D10A0A] text-white nu-glow-accent"
              : "border-[#D10A0A] bg-[#D10A0A]/10 text-[#FF1F1F] hover:bg-[#D10A0A] hover:text-white"
          }`}>
          {recording ? <Square className="w-3 h-3" fill="currentColor" /> : <Mic className="w-3 h-3" />}
          {recording ? "Stop" : "Record"}
        </button>
        <div className="font-mono-dj text-[10px] text-[#A1A1AA] flex items-center justify-center gap-1.5">
          {recording && <span className="w-2 h-2 rounded-full bg-[#FF1F1F] beat-pulse" />}
          <span data-testid="record-elapsed">{fmt(elapsed)}</span>
        </div>
        <div className="flex gap-1">
          <button data-testid="save-set-open"
            onClick={() => onOpenSaveSet?.(lastRecordingRef.current.duration || elapsed)}
            className="flex-1 px-2 py-1 rounded border border-white/15 text-[9px] font-bold uppercase tracking-[0.15em] text-[#A1A1AA] hover:text-white hover:border-white/30">
            Save Set
          </button>
          <button data-testid="saved-sets-open" onClick={() => onOpenSavedSets?.()}
            className="px-2 py-1 rounded border border-white/15 text-[9px] text-[#A1A1AA] hover:text-white hover:border-white/30"
            title="My Sets">
            <FolderOpen className="w-3 h-3" />
          </button>
          <button data-testid="midi-open" onClick={() => onOpenMidi?.()}
            className={`px-2 py-1 rounded border text-[9px] transition ${
              midi.enabled ? "border-[#D10A0A] text-[#FF1F1F] bg-[#D10A0A]/10" : "border-white/15 text-[#A1A1AA] hover:text-white hover:border-white/30"
            }`} title="MIDI">
            <Gamepad2 className="w-3 h-3" />
          </button>
        </div>
        <div className="text-[8px] tracking-[0.2em] uppercase text-[#52525B] flex items-center justify-center gap-1">
          <Download className="w-2.5 h-2.5" /> webm
        </div>
      </div>

      <HeadphoneSection />
    </div>
  );
}
