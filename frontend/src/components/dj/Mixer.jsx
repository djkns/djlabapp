import { useEffect, useRef, useState } from "react";
import { Mic, Square, Download } from "lucide-react";
import { useDJStore } from "@/store/djStore";
import {
  getAudioContext,
  resumeAudioContext,
  startMasterRecording,
  stopMasterRecording,
  crossfadeGains,
} from "@/lib/audioEngine";
import { toast } from "sonner";

export default function Mixer({ deckChains }) {
  const crossfader = useDJStore((s) => s.crossfader);
  const setCrossfader = useDJStore((s) => s.setCrossfader);
  const masterVolume = useDJStore((s) => s.masterVolume);
  const setMasterVolume = useDJStore((s) => s.setMasterVolume);
  const recording = useDJStore((s) => s.recording);
  const setRecording = useDJStore((s) => s.setRecording);

  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const intervalRef = useRef(null);
  const [levels, setLevels] = useState({ l: 0, r: 0 });

  // Apply crossfader → deck crossfade gains
  useEffect(() => {
    const { a, b } = crossfadeGains(crossfader);
    deckChains?.deckA?.setCrossfade?.(a);
    deckChains?.deckB?.setCrossfade?.(b);
  }, [crossfader, deckChains]);

  // Apply master volume
  useEffect(() => {
    const { masterGain } = getAudioContext();
    masterGain.gain.value = masterVolume;
  }, [masterVolume]);

  // Master VU meter from master analyser
  useEffect(() => {
    const { masterAnalyser } = getAudioContext();
    const buf = new Uint8Array(masterAnalyser.frequencyBinCount);
    let raf;
    const loop = () => {
      masterAnalyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      setLevels({ l: rms, r: rms });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const start = async () => {
    await resumeAudioContext();
    elapsedRef.current = 0;
    setElapsed(0);
    startMasterRecording((blob, mime) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `djlab-mix-${new Date().toISOString().replace(/[:.]/g, "-")}.${mime.includes("webm") ? "webm" : "ogg"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Mix downloaded", { description: `${(blob.size / 1024 / 1024).toFixed(2)} MB` });
    });
    setRecording(true);
    intervalRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    toast.message("Recording started", { description: "Everything hitting the master bus is being captured." });
  };

  const stop = () => {
    stopMasterRecording();
    setRecording(false);
    clearInterval(intervalRef.current);
  };

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const meterFill = (v) => Math.min(1, v * 3);

  return (
    <div
      data-testid="mixer"
      className="flex flex-col gap-5 bg-[#0a0a0a] border-x border-white/5 p-4 items-center justify-between min-w-[180px]"
    >
      {/* Title / master VU */}
      <div className="w-full text-center">
        <div className="label-tiny mb-2">MASTER</div>
        <div className="flex justify-center gap-1">
          {[0, 1].map((ch) => (
            <div key={ch} className="w-3 h-28 bg-[#1a1a1a] rounded overflow-hidden flex flex-col-reverse relative">
              <div
                className="w-full"
                style={{
                  height: `${meterFill(ch === 0 ? levels.l : levels.r) * 100}%`,
                  background: "linear-gradient(to top, #22c55e 0%, #22c55e 55%, #eab308 75%, #FF1F1F 95%)",
                  transition: "height 40ms linear",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Master volume knob */}
      <div className="flex flex-col items-center gap-1">
        <span className="label-tiny">MASTER VOL</span>
        <input
          type="range"
          min={0}
          max={1.2}
          step={0.01}
          value={masterVolume}
          onChange={(e) => setMasterVolume(+e.target.value)}
          className="fader-vert"
          style={{ height: 100 }}
          data-testid="master-volume"
        />
      </div>

      {/* Record */}
      <div className="w-full flex flex-col items-center gap-2">
        <button
          data-testid="record-toggle"
          onClick={recording ? stop : start}
          className={`w-full px-4 py-3 rounded border-2 text-[11px] font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all ${
            recording
              ? "border-[#FF1F1F] bg-[#D10A0A] text-white nu-glow-accent"
              : "border-[#D10A0A] bg-[#D10A0A]/10 text-[#FF1F1F] hover:bg-[#D10A0A] hover:text-white"
          }`}
        >
          {recording ? <Square className="w-3.5 h-3.5" fill="currentColor" /> : <Mic className="w-3.5 h-3.5" />}
          {recording ? "Stop" : "Record"}
        </button>
        <div className="font-mono-dj text-[10px] text-[#A1A1AA] flex items-center gap-1.5">
          {recording && <span className="w-2 h-2 rounded-full bg-[#FF1F1F] beat-pulse" />}
          <span data-testid="record-elapsed">{fmt(elapsed)}</span>
        </div>
        <div className="text-[9px] tracking-[0.2em] uppercase text-[#52525B] flex items-center gap-1">
          <Download className="w-2.5 h-2.5" /> Auto-downloads webm
        </div>
      </div>

      {/* Crossfader */}
      <div className="w-full">
        <div className="flex justify-between items-center mb-1 px-1">
          <span className="label-tiny" style={{ color: "#FF1F1F" }}>A</span>
          <span className="label-tiny">CROSSFADER</span>
          <span className="label-tiny" style={{ color: "#FF1F1F" }}>B</span>
        </div>
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full pointer-events-none cf-trail"
            style={{
              opacity: 0.9,
              transform: `translateX(${crossfader * 20}%)`,
              transition: "transform 80ms ease-out",
            }}
          />
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={crossfader}
            onChange={(e) => setCrossfader(+e.target.value)}
            onDoubleClick={() => setCrossfader(0)}
            className="fader-horiz w-full"
            data-testid="crossfader"
          />
        </div>
      </div>
    </div>
  );
}
