import React, { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Square, Download, FolderOpen, Gamepad2, Headphones as HpIcon } from "lucide-react";
import { useDJStore } from "@/store/djStore";
import {
  getAudioContext, resumeAudioContext,
  startMasterRecording, stopMasterRecording, crossfadeGains,
  enableMic, enableMicWithStream, setMicVolume,
  enableHeadphones, setHeadphoneMix, setHeadphoneVolume, setHeadphoneSplit,
  getDeckChain, DJ_MIC_CONSTRAINTS, getMicAnalyser,
} from "@/lib/audioEngine";
import { toast } from "sonner";
import EQKnob from "./EQKnob";
import SmoothSlider from "./SmoothSlider";
import MicDevicePicker from "./MicDevicePicker";

// Thin vertical stereo VU bar driven by a deck's analyser
function ChannelVUInner({ analyser, tall = false }) {
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
// Memoized so dragging a sibling fader doesn't re-reconcile the VU on every
// onChange tick. The analyser ref is stable across renders, so memoization is safe.
const ChannelVU = React.memo(ChannelVUInner);

// Horizontal mic-input level meter. Polls the mic analyser and shows raw
// input level so the user can verify samples are flowing BEFORE worrying
// about output routing. Self-mounted only when the mic is enabled.
function MicInputVU() {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    let raf;
    const loop = () => {
      const a = getMicAnalyser();
      if (a) {
        const buf = new Uint8Array(a.frequencyBinCount);
        a.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        setLevel(Math.sqrt(sum / buf.length));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const fill = Math.min(1, level * 4);
  return (
    <div data-testid="mic-input-vu" className="w-12 h-1.5 mt-1 bg-[#0c0c0c] rounded overflow-hidden border border-white/5">
      <div
        className="h-full"
        style={{
          width: `${fill * 100}%`,
          background: "linear-gradient(to right, #22c55e 0%, #22c55e 55%, #eab308 75%, #FF1F1F 95%)",
          transition: "width 40ms linear",
        }}
      />
    </div>
  );
}

// Channel strip: Gain → EQ(HIGH/MID/LOW) → Filter → Tempo fader (volume lives in its own row above the crossfader)
function ChannelStrip({ deckId, deckLabel, chain }) {
  // Subscribe ONLY to the specific fields this strip uses so dragging a fader
  // elsewhere doesn't re-render this whole knob stack. Tempo + Volume are
  // extracted into their own child components (TempoFader / VolumeFader) so
  // dragging those doesn't cascade re-renders through the knobs.
  const trim = useDJStore((s) => s[deckId].trim);
  const filter = useDJStore((s) => s[deckId].filter);
  const eqLow = useDJStore((s) => s[deckId].eq.low);
  const eqMid = useDJStore((s) => s[deckId].eq.mid);
  const eqHigh = useDJStore((s) => s[deckId].eq.high);
  const setDeck = useDJStore((s) => s.setDeck);
  const setDeckEQ = useDJStore((s) => s.setDeckEQ);
  const letter = deckId === "deckA" ? "a" : "b";

  // Prefer the module-level registry — prop may be null due to React effect
  // ordering (child effects run before parent). This was why Gain/Filter were
  // visually moving but not audibly doing anything.
  const liveChain = chain || getDeckChain(deckId);

  useEffect(() => { liveChain?.setTrim?.(trim); }, [liveChain, trim]);
  useEffect(() => { liveChain?.setFilter?.(filter); }, [liveChain, filter]);
  useEffect(() => { liveChain?.setLow?.(eqLow); }, [liveChain, eqLow]);
  useEffect(() => { liveChain?.setMid?.(eqMid); }, [liveChain, eqMid]);
  useEffect(() => { liveChain?.setHigh?.(eqHigh); }, [liveChain, eqHigh]);
  // Volume wiring is owned by VolumeFader to avoid duplicate subscription.
  // Also re-apply on chain-ready so late-registering chains pick up current store values
  useEffect(() => {
    const apply = () => {
      const ch = getDeckChain(deckId);
      if (!ch) return;
      const s = useDJStore.getState()[deckId];
      ch.setTrim?.(s.trim);
      ch.setFilter?.(s.filter);
      ch.setLow?.(s.eq.low);
      ch.setMid?.(s.eq.mid);
      ch.setHigh?.(s.eq.high);
      ch.setVolume?.(s.volume);
    };
    window.addEventListener("dj:chain-ready", apply);
    apply();
    return () => window.removeEventListener("dj:chain-ready", apply);
  }, [deckId]);

  // STABLE onChange callbacks for each knob. Without these, ChannelStrip
  // creates a fresh inline arrow each render, busting React.memo on EQKnob,
  // so dragging ANY knob re-renders ALL 5 knobs in the strip 60×/sec.
  // setDeck / setDeckEQ from Zustand are reference-stable; deckId is stable.
  const onTrim   = useCallback((v) => setDeck(deckId, { trim: v }),   [deckId, setDeck]);
  const onFilter = useCallback((v) => setDeck(deckId, { filter: v }), [deckId, setDeck]);
  const onEqLow  = useCallback((v) => setDeckEQ(deckId, "low",  v),   [deckId, setDeckEQ]);
  const onEqMid  = useCallback((v) => setDeckEQ(deckId, "mid",  v),   [deckId, setDeckEQ]);
  const onEqHigh = useCallback((v) => setDeckEQ(deckId, "high", v),   [deckId, setDeckEQ]);

  return (
    <div className="flex flex-col items-center gap-1 px-1.5" data-testid={`channel-strip-${letter}`}>
      <span className="label-tiny" style={{ color: "#FF1F1F" }}>DECK {deckLabel}</span>

      {/* Knobs | Tempo fader — side-by-side (volume fader lives in its own row above the crossfader) */}
      <div className="flex gap-1.5 items-start">
        {/* Knob column */}
        <div className="flex flex-col items-center gap-1">
          <EQKnob label="GAIN" value={trim} min={-12} max={12}
            onChange={onTrim}
            testid={`channel-${letter}-trim`} />
          <EQKnob label="HIGH" value={eqHigh} onChange={onEqHigh} testid={`channel-${letter}-eq-high`} />
          <EQKnob label="MID"  value={eqMid}  onChange={onEqMid}  testid={`channel-${letter}-eq-mid`} />
          <EQKnob label="LOW"  value={eqLow}  onChange={onEqLow}  testid={`channel-${letter}-eq-low`} />
          <EQKnob label="FILTER" value={filter} min={-1} max={1}
            onChange={onFilter}
            testid={`channel-${letter}-filter`}
            color="#FF9500"
          />
        </div>

        {/* Tempo / Pitch fader — its own component so changes don't re-render the whole strip */}
        <TempoFader deckId={deckId} letter={letter} />
      </div>
    </div>
  );
}

function TempoFaderInner({ deckId, letter }) {
  const tempoPct = useDJStore((s) => s[deckId].tempoPct);
  const tempoRange = useDJStore((s) => s[deckId].tempoRange);
  const setDeck = useDJStore((s) => s.setDeck);
  const setSyncedTo = useDJStore((s) => s.setSyncedTo);
  // Manual fader move = break sync (standard DJ-mixer behavior). The follow
  // effect would otherwise immediately overwrite the user's value.
  const onChange = useCallback((v) => {
    if (useDJStore.getState()[deckId].syncedTo) setSyncedTo(deckId, null);
    setDeck(deckId, { tempoPct: v });
  }, [deckId, setDeck, setSyncedTo]);
  const onReset  = useCallback(() => {
    if (useDJStore.getState()[deckId].syncedTo) setSyncedTo(deckId, null);
    setDeck(deckId, { tempoPct: 0 });
  }, [deckId, setDeck, setSyncedTo]);
  return (
    <div className="flex flex-col items-center gap-1 pt-2">
      <span className="label-tiny">TEMPO</span>
      <span className="font-mono-dj text-[9px] text-[#A1A1AA]" data-testid={`channel-${letter}-tempo-readout`}>
        {tempoPct > 0 ? "+" : ""}{tempoPct.toFixed(1)}%
      </span>
      <SmoothSlider
        min={-tempoRange} max={tempoRange} step={0.1}
        value={tempoPct}
        onChange={onChange}
        onDoubleClick={onReset}
        className="fader-vert"
        style={{ height: 160 }}
        testid={`channel-${letter}-tempo`}
        title="Double-click to reset"
      />
      <span className="label-tiny">±{tempoRange}%</span>
    </div>
  );
}
// Memoize so dragging an EQ knob in the same ChannelStrip doesn't re-render
// the tempo fader. Props (deckId, letter) are stable strings.
const TempoFader = React.memo(TempoFaderInner);

function VolumeFader({ deckId, chain }) {
  const volume = useDJStore((s) => s[deckId].volume);
  const setDeck = useDJStore((s) => s.setDeck);
  const letter = deckId === "deckA" ? "a" : "b";
  const liveChain = chain || getDeckChain(deckId);
  useEffect(() => { liveChain?.setVolume?.(volume); }, [liveChain, volume]);
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="label-tiny">VOL {letter.toUpperCase()}</span>
      <div className="flex items-end gap-1">
        <SmoothSlider
          min={0} max={1} step="any"
          value={volume}
          onChange={(v) => setDeck(deckId, { volume: v })}
          className="fader-vert" style={{ height: 110 }}
          testid={`channel-${letter}-volume`}
        />
        <ChannelVU analyser={chain?.analyser} />
      </div>
    </div>
  );
}

// Master VU bars (stereo). OWNS its own rAF loop + level state so its 60Hz
// updates DO NOT re-render the parent Mixer (which would cascade re-renders
// to every knob and fader and visibly lag knob drags).
function MasterVUInner() {
  const [levels, setLevels] = useState({ l: 0, r: 0 });
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
const MasterVU = React.memo(MasterVUInner);

export default function Mixer({ deckChains, onOpenSaveSet, onOpenSavedSets, onOpenMidi }) {
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
    const { ctx, masterGain } = getAudioContext();
    masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.01);
  }, [masterVolume]);

  // Mic enable/disable + volume → audio engine
  // Note: the actual getUserMedia call is made directly in the mic button's
  // onClick handler to satisfy Safari's "direct user gesture" requirement.
  // This effect only handles the volume update for a mic that's already active.
  useEffect(() => { if (mic.enabled) setMicVolume(mic.volume); }, [mic.volume, mic.enabled]);

  // Hot-swap mic source when user changes the device picker while mic is
  // already live. Tear down the current stream and re-grab from the new
  // device. We keep this effect outside the click handler because this
  // path doesn't need a fresh user gesture (permission already granted).
  useEffect(() => {
    if (!mic.enabled) return;
    let cancelled = false;
    (async () => {
      try {
        await enableMic(false); // disconnect current source
        const deviceId = mic.deviceId && mic.deviceId !== "default" ? mic.deviceId : null;
        const constraints = deviceId
          ? { ...DJ_MIC_CONSTRAINTS, deviceId: { exact: deviceId } }
          : DJ_MIC_CONSTRAINTS;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints })
          .catch(() => navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true }));
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        const ok = await enableMicWithStream(stream);
        if (ok) setMicVolume(mic.volume);
        else { setMic({ enabled: false }); toast.error("Failed to switch mic input"); }
      } catch (err) {
        console.error("[mic] hot-swap failed", err);
        setMic({ enabled: false });
        toast.error("Mic source switch failed", { description: err?.message || err?.name });
      }
    })();
    return () => { cancelled = true; };
    // Intentionally NOT depending on mic.volume — that has its own effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mic.deviceId]);

  const handleMicToggle = () => {
    if (mic.enabled) {
      // Disabling is safe to do via async
      (async () => {
        await enableMic(false);
        setMic({ enabled: false });
        toast.message("Mic off");
      })();
      return;
    }

    // The #1 reason mic gets blocked even when Firefox says "Allow" is that
    // DJ Lab is running inside the Emergent preview iframe. Firefox grants
    // mic permission to the TOP-level page, so the iframe inherits "ask"
    // instead of "allow" — and Firefox's iframe permission UI can be hard
    // to find. Best fix: open the app in its own tab. We surface that here
    // as a one-click action when blocked.
    const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
    const openInOwnTab = () => {
      try { window.open(window.location.href, "_blank", "noopener,noreferrer"); } catch { /* noop */ }
    };

    // Pre-check the permission state. If it's already 'denied', skip the
    // getUserMedia call (which would silently no-op in some Firefox builds)
    // and surface the iframe escape hatch up-front.
    if (inIframe && navigator.permissions?.query) {
      navigator.permissions.query({ name: "microphone" }).then((res) => {
        if (res.state === "denied") {
          toast.error("Mic blocked at browser level", {
            description: "The browser remembered a previous block. Open DJ Lab in its own tab and the prompt will appear again.",
            duration: 15000,
            action: { label: "Open in own tab", onClick: openInOwnTab },
          });
        }
      }).catch(() => { /* permissions API not always available, fall through */ });
    }

    // Firefox / Safari require getUserMedia to be called synchronously inside
    // the user-gesture click handler. Resume AudioContext in parallel.
    // Some Firefox profiles reject explicit `false` constraint values
    // (OverconstrainedError on echoCancellation/AGC/NS), so we try the
    // DJ-grade strict constraints first and fall back to simple `audio: true`
    // if that throws. Either way the gesture is preserved.
    // Also: bind to the user's selected input device (T7 mic input vs
    // built-in laptop mic). "default" lets the OS pick.
    const deviceId = mic.deviceId && mic.deviceId !== "default" ? mic.deviceId : null;
    const baseConstraints = deviceId
      ? { ...DJ_MIC_CONSTRAINTS, deviceId: { exact: deviceId } }
      : DJ_MIC_CONSTRAINTS;
    let micPromise = navigator.mediaDevices.getUserMedia({ audio: baseConstraints })
      .catch((err) => {
        // Fall back to plain `{ audio: true }` (still honoring deviceId if
        // any) on any error class where the strict constraints could
        // plausibly be the cause. Firefox in particular can throw
        // NotFoundError on the strict constraint set even when a working
        // mic exists.
        const fallbackErrors = ["OverconstrainedError", "TypeError", "NotReadableError", "NotFoundError"];
        if (fallbackErrors.includes(err?.name)) {
          console.warn("[mic] strict constraints rejected, falling back to plain audio", err.name);
          const fallback = deviceId ? { deviceId: { exact: deviceId } } : true;
          return navigator.mediaDevices.getUserMedia({ audio: fallback });
        }
        throw err;
      });
    resumeAudioContext();
    (async () => {
      try {
        const stream = await micPromise;
        const ok = await enableMicWithStream(stream);
        if (ok) {
          setMicVolume(mic.volume);
          setMic({ enabled: true });
          toast.success("Mic live", { description: "Routed to master bus." });
        } else {
          throw new Error("audio graph error");
        }
      } catch (err) {
        console.error("mic denied", err);
        setMic({ enabled: false });
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        // Most common: blocked by iframe permission policy. Give the user
        // a one-click escape hatch — opening the app in its own tab makes
        // the browser prompt asking for mic permission directly.
        if (err?.name === "NotAllowedError" && inIframe) {
          toast.error("Mic blocked by preview frame", {
            description:
              "The browser is blocking mic access because DJ Lab is loaded inside a preview frame. Click 'Open in own tab' below — the prompt will then appear directly.",
            duration: 15000,
            action: { label: "Open in own tab", onClick: openInOwnTab },
          });
          return;
        }
        const reason =
          err?.name === "NotAllowedError" ? "You (or the browser) blocked mic access." :
          err?.name === "NotFoundError" ? "No microphone device found." :
          err?.name === "NotReadableError" ? "Mic is in use by another app." :
          err?.name === "SecurityError" ? "Browser security blocked the request (must be HTTPS)." :
          err?.message || "Unknown error";
        toast.error("Mic access denied", {
          description: `${reason} If using Firefox, set ${origin} to "Allow" in Settings → Privacy → Permissions → Microphone, then reload.`,
          duration: 10000,
        });
      }
    })();
  };

  // Headphone sync → audio engine
  useEffect(() => { setHeadphoneMix(hp.mix); }, [hp.mix]);
  useEffect(() => { setHeadphoneVolume(hp.volume); }, [hp.volume]);
  useEffect(() => { setHeadphoneSplit(!!hp.splitCue); }, [hp.splitCue]);
  useEffect(() => { enableHeadphones(hp.enabled); }, [hp.enabled]);

  const start = async () => {
    await resumeAudioContext();
    elapsedRef.current = 0; setElapsed(0);
    startMasterRecording((blob, mime, durationSec) => {
      lastRecordingRef.current = { blob, duration: durationSec };
      // Notify DJLab so the Export dialog can access the recording
      window.dispatchEvent(new CustomEvent("dj:recording-complete", { detail: { blob, duration: durationSec, mime } }));
      toast.success("Mix ready", {
        description: `${(blob.size / 1024 / 1024).toFixed(2)} MB · open Export to save as MP3 / WAV`,
        action: { label: "Export", onClick: () => window.dispatchEvent(new CustomEvent("dj:open-export")) },
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
      else if (action === "hp.master") setHp({ masterEnabled: !useDJStore.getState().hp.masterEnabled });
      else if (action === "hp.enabled") setHp({ enabled: !useDJStore.getState().hp.enabled });
      else if (action === "crossfader") useDJStore.getState().setCrossfader(Math.max(-1, Math.min(1, value)));
      else if (action === "mic.enabled") { await resumeAudioContext(); setMic({ enabled: !mic.enabled }); }
      else if (action === "mic.volume") setMic({ volume: Math.max(0, Math.min(3.0, value * 3.0)) });
    };
    window.addEventListener("dj:action", h);
    return () => window.removeEventListener("dj:action", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, mic.enabled]);

  const fmt = (s) => {
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

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
          <button
            data-testid="hp-split"
            onClick={() => setHp({ splitCue: !hp.splitCue })}
            className={`text-[9px] font-mono-dj tracking-[0.18em] px-2 py-0.5 rounded border transition-all ${
              hp.splitCue
                ? "border-[#FF9500]/70 text-[#FF9500] bg-[#FF9500]/10 shadow-[0_0_8px_#FF950055]"
                : "border-white/15 text-[#52525B] hover:border-white/40 hover:text-white/80"
            }`}
            title="SPLIT — left ear = cue, right ear = master (overrides CUE MIX)"
          >
            SPLIT
          </button>
          <EQKnob
            label="CUE" value={hp.mix} min={0} max={1}
            onChange={(v) => setHp({ mix: Math.max(0, Math.min(1, v)) })}
            testid="hp-mix"
            color="#00D4FF"
          />
          <span className="text-[7px] font-mono-dj tracking-[0.15em] text-[#52525B] -mt-1" title="Knob ←  Master only · Knob →  PFL'd deck only">
            MSTR ← → CUE
          </span>
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
          <MasterVU />

          {/* Mic section */}
          <div className="flex flex-col items-center gap-0.5 mt-1 pt-1 border-t border-white/10 w-full">
            <span className="label-tiny" style={{ color: mic.enabled ? "#FF1F1F" : "#A1A1AA" }}>MIC</span>
            <MicDevicePicker />
            <button
              data-testid="mic-toggle"
              onClick={handleMicToggle}
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
              label="MIC VOL" value={mic.volume} min={0} max={3.0}
              onChange={(v) => setMic({ volume: Math.max(0, Math.min(3.0, v)) })}
              testid="mic-volume"
              color="#FF9500"
            />
            {/* Mic input level indicator — proves samples ARE flowing in.
                If this bounces when you talk, mic is reaching the engine
                and the master volume controls how loud it goes out. */}
            {mic.enabled && <MicInputVU />}
          </div>
        </div>
      </div>

      {/* Volume faders row — VOL A | VOL B flanking center */}
      <div className="flex items-end justify-around mt-3 pt-2 border-t border-white/5" data-testid="volume-row">
        <VolumeFader deckId="deckA" chain={deckChains?.deckA} />
        <VolumeFader deckId="deckB" chain={deckChains?.deckB} />
      </div>

      {/* Bottom transport rail — crossfader owns the bottom */}
      <CrossfaderRail />
    </div>
  );
}

function CrossfaderRail() {
  const crossfader = useDJStore((s) => s.crossfader);
  const setCrossfader = useDJStore((s) => s.setCrossfader);
  // Wire crossfader value -> deck chains. Only this component re-renders on
  // crossfader changes, so the rest of the Mixer isn't touched on drag.
  useEffect(() => {
    const { a, b } = crossfadeGains(crossfader);
    getDeckChain("deckA")?.setCrossfade?.(a);
    getDeckChain("deckB")?.setCrossfade?.(b);
  }, [crossfader]);
  return (
    <div className="pt-1 pb-0.5 border-t border-[#D10A0A]/40 bg-gradient-to-b from-transparent to-[#0f0f0f]">
      <div className="flex justify-between items-center px-1">
        <span className="label-tiny" style={{ color: "#FF1F1F" }}>A</span>
        <span className="label-tiny">CROSSFADER</span>
        <span className="label-tiny" style={{ color: "#FF1F1F" }}>B</span>
      </div>
      <div className="relative">
        <div className="absolute inset-0 rounded-full pointer-events-none cf-trail"
          style={{ opacity: 0.9, transform: `translateX(${crossfader * 20}%)`, transition: "transform 80ms ease-out" }} />
        <SmoothSlider
          min={-1} max={1} step={0.01}
          value={crossfader}
          onChange={setCrossfader}
          onDoubleClick={() => setCrossfader(0)}
          className="fader-horiz w-full"
          testid="crossfader" />
      </div>
    </div>
  );
}
