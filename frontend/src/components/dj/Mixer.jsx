import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Square, Download, FolderOpen, Gamepad2, Headphones as HpIcon } from "lucide-react";
import { useDJStore } from "@/store/djStore";
import {
  getAudioContext, resumeAudioContext,
  startMasterRecording, stopMasterRecording, crossfadeGains,
  enableMic, setMicVolume,
  enableHeadphones, setHeadphoneMix, setHeadphoneVolume,
  getDeckChain,
} from "@/lib/audioEngine";
import { toast } from "sonner";
import EQKnob from "./EQKnob";

// Thin vertical stereo VU bar driven by a deck's analyser
function ChannelVU({ analyser, tall = false }) {
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
    <div className={`w-2 ${tall ? "h-[220px]" : "h-16"} bg-[#0c0c0c] rounded overflow-hidden flex flex-col-reverse border border-white/5`}>
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

      {/* Knobs | Tempo fader — side-by-side (volume fader lives in its own row above the crossfader) */}
      <div className="flex gap-1.5 items-start">
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
            style={{ height: 160 }}
            data-testid={`channel-${letter}-tempo`}
            title="Double-click to reset"
          />
          <span className="label-tiny">±{deck.tempoRange}%</span>
        </div>
      </div>
    </div>
  );
}

// Compact volume fader + VU for the crossfader row
function VolumeFader({ deckId, chain }) {
  const deck = useDJStore((s) => s[deckId]);
  const setDeck = useDJStore((s) => s.setDeck);
  const letter = deckId === "deckA" ? "a" : "b";
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="label-tiny">VOL {letter.toUpperCase()}</span>
      <div className="flex items-end gap-1">
        <input type="range" min={0} max={1} step={0.01} value={deck.volume}
          onChange={(e) => setDeck(deckId, { volume: +e.target.value })}
          className="fader-vert" style={{ height: 110 }}
          data-testid={`channel-${letter}-volume`} />
        <ChannelVU analyser={chain?.analyser} />
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
  const mic = useDJStore((s) => s.mic);
  const setMic = useDJStore((s) => s.setMic);
  const midi = useDJStore((s) => s.midi);

  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const intervalRef = useRef(null);
  const lastRecordingRef = useRef({ blob: null, duration: 0 });
  const [levels, setLevels] = useState({ l: 0, r: 0 });

  useEffect(() => {
    const applyCrossfade = () => {
      const { a, b } = crossfadeGains(useDJStore.getState().crossfader);
      getDeckChain("deckA")?.setCrossfade?.(a);
      getDeckChain("deckB")?.setCrossfade?.(b);
    };
    // Apply whenever a new deck chain registers
    window.addEventListener("dj:chain-ready", applyCrossfade);
    // Also do one initial pass in case chains already exist
    applyCrossfade();
    return () => window.removeEventListener("dj:chain-ready", applyCrossfade);
  }, []);

  useEffect(() => {
    const { a, b } = crossfadeGains(crossfader);
    // Prefer module-level registry (avoids React effect ordering race); fall
    // back to props for decks that haven't registered yet.
    const chA = getDeckChain("deckA") || deckChains?.deckA;
    const chB = getDeckChain("deckB") || deckChains?.deckB;
    chA?.setCrossfade?.(a);
    chB?.setCrossfade?.(b);
  }, [crossfader, deckChains]);

  useEffect(() => {
    const { masterGain } = getAudioContext();
    masterGain.gain.value = masterVolume;
  }, [masterVolume]);

  // Mic enable/disable + volume → audio engine
  useEffect(() => {
    (async () => {
      const ok = await enableMic(mic.enabled);
      if (mic.enabled && !ok) {
        setMic({ enabled: false });
        toast.error("Mic access denied", { description: "Check browser permissions." });
      } else if (mic.enabled && ok) {
        setMicVolume(mic.volume);
        toast.success("Mic active", { description: "Routed to master bus." });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic.enabled]);
  useEffect(() => { if (mic.enabled) setMicVolume(mic.volume); }, [mic.volume, mic.enabled]);

  // Headphone sync → audio engine
  useEffect(() => { setHeadphoneMix(hp.mix); }, [hp.mix]);
  useEffect(() => { setHeadphoneVolume(hp.volume); }, [hp.volume]);
  useEffect(() => { enableHeadphones(hp.enabled); }, [hp.enabled]);

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
    intervalRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
      window.dispatchEvent(new CustomEvent("dj:record-elapsed", { detail: { elapsed: elapsedRef.current } }));
    }, 1000);
    toast.message("Recording started", { description: "Capturing the master bus." });
  };
  const stop = () => {
    stopMasterRecording(); setRecording(false); clearInterval(intervalRef.current);
    window.dispatchEvent(new CustomEvent("dj:record-elapsed", { detail: { elapsed: 0 } }));
  };

  useEffect(() => {
    const h = async (e) => {
      const { action, value } = e.detail;
      if (action === "master.record") (recording ? stop() : start());
      else if (action === "master.volume") setMasterVolume(Math.max(0, Math.min(1.2, value * 1.2)));
      else if (action === "hp.volume") setHp({ volume: value });
      else if (action === "hp.mix") setHp({ mix: value });
      else if (action === "crossfader") setCrossfader(Math.max(-1, Math.min(1, value)));
      else if (action === "mic.enabled") { await resumeAudioContext(); setMic({ enabled: !mic.enabled }); }
      else if (action === "mic.volume") setMic({ volume: Math.max(0, Math.min(1.2, value * 1.2)) });
    };
    window.addEventListener("dj:action", h);
    return () => window.removeEventListener("dj:action", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, mic.enabled]);

  const fmt = (s) => {
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };
  const meterFill = (v) => Math.min(1, v * 3);

  return (
    <div data-testid="mixer"
      className="flex flex-col h-full bg-[#0a0a0a] border-x border-white/5 px-2 py-2 items-stretch overflow-hidden gap-1">

      {/* Top: HP | Deck A strip | Deck B strip | Master — content-sized */}
      <div className="flex gap-1 justify-center min-h-0">
        {/* LEFT — Headphone column */}
        <div className="flex flex-col items-center gap-1 px-0.5" data-testid="hp-column">
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
        <div className="flex flex-col items-center gap-1 px-0.5" data-testid="master-column">
          <span className="label-tiny" style={{ color: "#FF1F1F" }}>MSTR</span>
          <EQKnob
            label="MASTER" value={masterVolume} min={0} max={1.2}
            onChange={(v) => setMasterVolume(Math.max(0, Math.min(1.2, v)))}
            testid="master-volume"
            color="#FF1F1F"
          />
          <MasterVU levels={levels} />

          {/* Mic section */}
          <div className="flex flex-col items-center gap-0.5 mt-1 pt-1 border-t border-white/10 w-full">
            <span className="label-tiny" style={{ color: mic.enabled ? "#FF1F1F" : "#A1A1AA" }}>MIC</span>
            <button
              data-testid="mic-toggle"
              onClick={async () => { await resumeAudioContext(); setMic({ enabled: !mic.enabled }); }}
              className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all ${
                mic.enabled
                  ? "bg-[#D10A0A] border-[#FF1F1F] text-white shadow-[0_0_12px_#FF1F1F] beat-pulse"
                  : "border-white/20 text-[#A1A1AA] hover:border-white/50 hover:text-white"
              }`}
              title={mic.enabled ? "Mic is LIVE — click to mute" : "Enable microphone"}
            >
              {mic.enabled ? <Mic className="w-3 h-3 pointer-events-none" /> : <MicOff className="w-3 h-3 pointer-events-none" />}
            </button>
            <EQKnob
              label="MIC VOL" value={mic.volume} min={0} max={1.2}
              onChange={(v) => setMic({ volume: Math.max(0, Math.min(1.2, v)) })}
              testid="mic-volume"
              color="#FF9500"
            />
          </div>
        </div>
      </div>

      {/* Volume faders row — VOL A | VOL B flanking center */}
      <div className="flex items-end justify-around pt-1 border-t border-white/5" data-testid="volume-row">
        <VolumeFader deckId="deckA" chain={deckChains?.deckA} />
        <VolumeFader deckId="deckB" chain={deckChains?.deckB} />
      </div>

      {/* Bottom transport rail — crossfader owns the bottom */}
      <div className="pt-1 pb-0.5 border-t border-[#D10A0A]/40 bg-gradient-to-b from-transparent to-[#0f0f0f]">
        <div className="flex justify-between items-center px-1">
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
    </div>
  );
}
