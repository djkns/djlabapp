import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, SkipBack, Upload, Headphones, Activity } from "lucide-react";
import SpinningVinyl from "./SpinningVinyl";
import EQKnob from "./EQKnob";
import HotCuePad from "./HotCuePad";
import LoopControls from "./LoopControls";
import FXSlot from "./FXSlot";

import { useDJStore } from "@/store/djStore";
import { useShallow } from "zustand/react/shallow";
import { createDeckChain, registerDeckChain, resumeAudioContext, getAudioContext } from "@/lib/audioEngine";
import { readTags, readTagsFromUrl } from "@/lib/mediaTags";
import { analyze as analyzeBPM, guess as guessBPM } from "web-audio-beat-detector";
import { detectKeyAsync, labelToCamelot, camelotCompat } from "@/lib/keyDetect";
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
  const currentTimeRef = useRef(0);

  const deck = useDJStore(useShallow((s) => ({
    track: s[id].track,
    playing: s[id].playing,
    currentTime: s[id].currentTime,
    duration: s[id].duration,
    baseBPM: s[id].baseBPM,
    tempoPct: s[id].tempoPct,
    tempoRange: s[id].tempoRange,
    keylock: s[id].keylock,
    pflOn: s[id].pflOn,
    cuePoint: s[id].cuePoint,
    hotCues: s[id].hotCues,
    musicalKey: s[id].musicalKey,
    camelot: s[id].camelot,
  })));
  const otherDeck = useDJStore(useShallow((s) => ({
    track: id === "deckA" ? s.deckB.track : s.deckA.track,
    currentBPM: (id === "deckA" ? s.deckB : s.deckA).baseBPM *
                (1 + (id === "deckA" ? s.deckB : s.deckA).tempoPct / 100),
    camelot: id === "deckA" ? s.deckB.camelot : s.deckA.camelot,
  })));
  const setDeck = useDJStore((s) => s.setDeck);
  const setLoop = useDJStore((s) => s.setLoop);
  const setDeckEQ = useDJStore((s) => s.setDeckEQ);
  const setHotCue = useDJStore((s) => s.setHotCue);
  const setPfl = useDJStore((s) => s.setPfl);

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
    wsRef.current = ws;
    return () => { ws.destroy(); wsRef.current = null; };
  }, [accent]);

  // EQ/Volume/Filter/Trim are wired by Mixer's ChannelStrip (single source of
  // truth). Removing them from Deck means Deck doesn't re-render on those
  // changes, which kept slider drags lag-free.

  // PFL / headphone cue on this deck
  useEffect(() => { chainRef.current?.setCueActive(!!deck.pflOn); }, [deck.pflOn]);

  // Tempo (playback rate) + keylock. Throttle playbackRate writes so rapid
  // tempo-fader drags don't cause the HTMLMediaElement decoder to
  // continuously re-sync (audible as clicks / hiccups during tempo moves).
  const tempoWriteRef = useRef({ rate: 1, lastWrite: 0 });
  useEffect(() => {
    const el = audioElRef.current; if (!el) return;
    const targetRate = 1 + deck.tempoPct / 100;
    const delta = Math.abs(targetRate - tempoWriteRef.current.rate);
    const now = performance.now();
    // Write immediately if >0.5% change since last write; otherwise coalesce at 33fps
    if (delta > 0.005 || now - tempoWriteRef.current.lastWrite > 30) {
      el.playbackRate = targetRate;
      tempoWriteRef.current = { rate: targetRate, lastWrite: now };
    }
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
      // Track wavesurfer's load promise so the BPM analyzer can wait on it
      // and reuse its decoded AudioBuffer instead of fetching the URL again
      // (3 concurrent fetches of the same MP3 caused waveform + BPM to both
      // drop out — single source of truth fixes that).
      const wsLoaded = wsRef.current
        ? wsRef.current.load(playUrl).catch((err) => { console.warn("[ws] load failed", err); })
        : Promise.resolve();
      setDeck(id, { loading: false, baseBPM: track.bpm || 120, musicalKey: null, camelot: null, cuePoint: 0, currentTime: 0, hotCues: Array(8).fill(null), loop: { in: null, out: null, enabled: false, beats: null } });

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
                if (cached?.musical_key) {
                  patch.musicalKey = cached.musical_key;
                  patch.camelot = labelToCamelot(cached.musical_key);
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
              if (cached?.bpm && cached?.musical_key && !needsTagRead) return; // BPM + key + tags all cached → skip everything
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

          // 3. Detect musical key from the same decoded AudioBuffer.
          //    Runs in a Web Worker so the FFT pass doesn't freeze knob
          //    interactions on the main thread. Skip if a cached label was
          //    already restored earlier.
          const liveKeyState = useDJStore.getState()[id];
          if (!liveKeyState.musicalKey && liveKeyState.track?.key === trackKey) {
            try {
              const k = await detectKeyAsync(buf);
              const cur2 = useDJStore.getState()[id].track;
              if (k && cur2?.key === trackKey) {
                setDeck(id, { musicalKey: k.label, camelot: k.camelot });
                fetch(`${apiBase}/api/tracks/meta`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ key: trackKey, musical_key: k.label }),
                }).catch(() => {});
              }
            } catch (e) {
              console.warn("[key] detection failed", e);
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
    if (!deck.playing || (deck.currentTime || 0) < 30) return;
    playedMarkedRef.current = trackKey;
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/tracks/played`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: trackKey, deck: id === "deckA" ? "A" : "B" }),
    })
      .then(() => window.dispatchEvent(new CustomEvent("dj:track-played",
        { detail: { key: trackKey, deck: id === "deckA" ? "A" : "B" } })))
      .catch(() => {});
  }, [deck.track?.key, deck.playing, deck.currentTime]);

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

  const sync = () => {
    if (!otherDeck?.track || !deck.baseBPM) return;
    const otherCurrent = otherDeck.currentBPM;
    if (!otherCurrent) return;
    const desiredPct = (otherCurrent / deck.baseBPM - 1) * 100;
    const clamp = Math.max(-deck.tempoRange, Math.min(deck.tempoRange, desiredPct));
    setDeck(id, { tempoPct: clamp });
  };

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
    const doAction = (action, value) => {
      const prefix = `${id}.`;
      if (!action.startsWith(prefix)) return;
      const sub = action.slice(prefix.length);
      if (sub === "play")   togglePlay();
      else if (sub === "cue") cue();
      else if (sub === "sync") sync();
      else if (sub === "pfl") setPfl(id, !deck.pflOn);
      else if (sub === "keylock") setDeck(id, { keylock: !deck.keylock });
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

  // Compatibility light vs the OTHER deck — combines BPM Δ and Camelot match.
  // Both decks render the same status (it's a pair-wise comparison).
  const compat = (() => {
    if (!deck.track || !otherDeck.track) return null;
    const aEff = deck.baseBPM * (1 + deck.tempoPct / 100);
    const bEff = otherDeck.currentBPM;
    const bpmDelta = aEff && bEff ? Math.abs((bEff - aEff) / aEff) * 100 : null;
    const bpmStatus = bpmDelta == null ? null : bpmDelta <= 1 ? "harmonic" : bpmDelta <= 4 ? "energy" : "clash";
    const keyStatus = (deck.camelot && otherDeck.camelot) ? camelotCompat(deck.camelot, otherDeck.camelot) : null;
    const rank = { harmonic: 0, energy: 1, clash: 2 };
    const cands = [bpmStatus, keyStatus].filter(Boolean);
    if (!cands.length) return null;
    return cands.reduce((w, c) => (rank[c] > rank[w] ? c : w), cands[0]);
  })();
  const compatColor = compat === "harmonic" ? "#22c55e"
                    : compat === "energy"   ? "#eab308"
                    : compat === "clash"    ? "#ef4444"
                    : null;

  return (
    <div
      data-testid={`deck-${letter}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="relative flex flex-col gap-2 h-full bg-[#141414]/80 backdrop-blur-xl border border-white/10 p-3 rounded-lg"
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
              {/* Camelot key badge + compatibility dot vs other deck */}
              {deck.camelot && (
                <span
                  data-testid={`deck-${letter}-camelot`}
                  title={deck.musicalKey ? `Key · ${deck.musicalKey} (Camelot ${deck.camelot})` : ""}
                  className="font-mono-dj text-[10px] px-1.5 py-0.5 rounded border tracking-wide leading-none"
                  style={{
                    color: "#FF1F1F",
                    borderColor: "rgba(209,10,10,0.4)",
                    background: "rgba(209,10,10,0.08)",
                  }}
                >
                  {deck.camelot}
                </span>
              )}
              {compatColor && (
                <span
                  data-testid={`deck-${letter}-compat`}
                  title={`Mix vs Deck ${letter === "a" ? "B" : "A"}: ${compat?.toUpperCase()}`}
                  className="w-2 h-2 rounded-full"
                  style={{ background: compatColor, boxShadow: `0 0 8px ${compatColor}` }}
                />
              )}
              <div className="label-tiny">BPM</div>
              <div className="font-mono-dj font-bold text-base leading-none" style={{ color: accent }} data-testid={`deck-${letter}-bpm`}>
                {currentBPM}
              </div>
              {analyzingBPM && (
                <Activity className="w-3 h-3 text-[#FF9500] animate-pulse" data-testid={`deck-${letter}-bpm-analyzing`}
                          aria-label="Analyzing BPM" />
              )}
              <input
                type="number" value={deck.baseBPM}
                onChange={(e) => setDeck(id, { baseBPM: Math.max(40, Math.min(220, +e.target.value || 120)) })}
                className="bpm-input w-12 bg-black/60 border border-white/10 rounded px-1 py-0.5 text-[10px] font-mono-dj text-white text-center focus:outline-none focus:border-[#D10A0A]"
                data-testid={`deck-${letter}-base-bpm`} title="Base BPM"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Waveform — fills available vertical space; the play/cue row + hot
          cues sit pinned to the bottom via mt-auto so the waveform absorbs
          all extra height as the viewport grows. */}
      <div className="relative rounded overflow-hidden border border-white/10 flex-1 min-h-[140px]"
           style={{
             background:
               "repeating-linear-gradient(90deg, rgba(255,255,255,0.035) 0 1px, transparent 1px 40px), " +
               "linear-gradient(180deg, #050505 0%, #0b0b0b 50%, #050505 100%)",
           }}>
        <div ref={waveRef} data-testid={`deck-${letter}-waveform`} className="absolute inset-0" />
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
