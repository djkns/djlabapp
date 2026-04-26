import { useEffect, useRef, useState } from "react";
import { Play, Pause, Square, Zap } from "lucide-react";
import { toast } from "sonner";
import { analyze as analyzeBPM, guess as guessBPM } from "web-audio-beat-detector";
import { readTagsFromUrl } from "@/lib/mediaTags";
import { getAudioContext } from "@/lib/audioEngine";

/**
 * Background pre-cacher: one-shot job that walks the S3 library, fetches +
 * decodes each track that is missing BPM or cover art, runs the same BPM /
 * ID3 pipeline a deck-load would run, and POSTs the result to
 * /api/tracks/meta. Sequential single-fetch (no parallel) to keep memory and
 * network footprint small. Persists state per page-load only — restart-safe
 * because the backend already de-duplicates by `key`.
 *
 * Intentionally lives in its own component so its progress re-renders don't
 * touch the virtualised track list above it.
 */
export default function LibraryPrecacher({ tracks, onMetaUpdated }) {
  const [running, setRunning] = useState(false);
  const [pausedFlag, setPausedFlag] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [todoCount, setTodoCount] = useState(0);
  const [currentName, setCurrentName] = useState("");

  // Refs control the worker loop without re-rendering it on every step
  const cancelRef = useRef(false);
  const pausedRef = useRef(false);
  const queueRef = useRef([]);

  // Recompute "needs work" set whenever track list changes (so finished
  // tracks drop out, and newly-added tracks join the queue).
  useEffect(() => {
    const todo = tracks.filter(
      (t) => t.source === "s3" && (!t.bpm || !t.cover || !t.artist)
    );
    setTodoCount(todo.length);
    if (!running) queueRef.current = todo;
  }, [tracks, running]);

  const apiBase = process.env.REACT_APP_BACKEND_URL;

  const processOne = async (track) => {
    setCurrentName(track.name || track.key);
    // Resolve playable URL
    let playUrl = track.url;
    if (!playUrl) {
      const r = await fetch(`${apiBase}/api/tracks/url?key=${encodeURIComponent(track.key)}`);
      const d = await r.json();
      playUrl = d.url?.startsWith("http") ? d.url : `${apiBase}${d.url}`;
    }

    // ID3 tags (best-effort, partial range fetch)
    let tags = null;
    if (!track.cover || !track.artist || !track.title) {
      try { tags = await readTagsFromUrl(playUrl); } catch { /* keep null */ }
    }

    // BPM (skip if already cached)
    let bpm = track.bpm || null;
    if (!bpm) {
      try {
        const resp = await fetch(playUrl);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        const arr = await resp.arrayBuffer();
        const buf = await getAudioContext().ctx.decodeAudioData(arr);
        let a = null, g = null;
        try { a = await analyzeBPM(buf); } catch { /* noop */ }
        try { const x = await guessBPM(buf); g = x?.bpm ?? null; } catch { /* noop */ }
        if (a && g) {
          const diff = Math.abs(a - g) / Math.max(a, g);
          bpm = diff < 0.05 ? g : (Math.round(a) === 120 ? g : Math.round(g) === 120 ? a : g);
        } else {
          bpm = a || g;
        }
        if (bpm && (bpm < 60 || bpm > 200)) bpm = null;
      } catch (err) {
        console.warn("[precache] decode/bpm failed for", track.key, err);
      }
    }

    // POST upsert (only if we learnt something)
    const payload = { key: track.key };
    if (bpm) payload.bpm = bpm;
    if (tags?.title) payload.title = tags.title;
    if (tags?.artist) payload.artist = tags.artist;
    if (tags?.album) payload.album = tags.album;
    if (tags?.picture) payload.cover = tags.picture;
    if (Object.keys(payload).length > 1) {
      try {
        await fetch(`${apiBase}/api/tracks/meta`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        onMetaUpdated?.(track.key, payload);
      } catch (err) {
        console.warn("[precache] upsert failed for", track.key, err);
      }
    }
  };

  const start = async () => {
    if (running) return;
    cancelRef.current = false;
    pausedRef.current = false;
    setPausedFlag(false);
    setRunning(true);
    setDoneCount(0);
    const queue = queueRef.current.slice();
    toast.message("Pre-caching started", { description: `Working through ${queue.length} tracks in the background.` });
    for (let i = 0; i < queue.length; i++) {
      if (cancelRef.current) break;
      // Pause loop
      while (pausedRef.current && !cancelRef.current) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (cancelRef.current) break;
      await processOne(queue[i]);
      setDoneCount(i + 1);
      // Yield to UI between tracks
      await new Promise((r) => setTimeout(r, 50));
    }
    setRunning(false);
    setCurrentName("");
    if (!cancelRef.current) {
      toast.success("Pre-cache complete", { description: `${queue.length} tracks processed.` });
    }
  };

  const togglePause = () => {
    pausedRef.current = !pausedRef.current;
    setPausedFlag(pausedRef.current);
  };

  const stop = () => {
    cancelRef.current = true;
    pausedRef.current = false;
    setPausedFlag(false);
  };

  if (todoCount === 0 && !running) return null;

  const pct = todoCount ? Math.round((doneCount / Math.max(1, queueRef.current.length || todoCount)) * 100) : 0;

  return (
    <div
      data-testid="library-precacher"
      className="px-3 py-2 border-b border-white/5 flex items-center gap-3 bg-gradient-to-r from-[#D10A0A]/10 via-transparent to-transparent"
    >
      <Zap className="w-3.5 h-3.5 text-[#FF9500]" />
      <span className="label-tiny text-[#A1A1AA]">PRE-CACHE</span>

      {!running ? (
        <>
          <span className="text-xs text-white">
            <span className="text-[#FF9500] font-mono-dj">{todoCount}</span>
            <span className="text-[#A1A1AA]"> tracks missing BPM / artwork</span>
          </span>
          <button
            data-testid="precache-start"
            onClick={start}
            className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded border border-[#FF9500]/40 text-[10px] tracking-[0.22em] uppercase font-bold text-[#FF9500] hover:bg-[#FF9500]/10 transition"
          >
            <Play className="w-3 h-3" /> Start
          </button>
        </>
      ) : (
        <>
          <span className="text-xs text-white truncate max-w-[40%]" title={currentName}>
            <span className="font-mono-dj text-[#FF9500]">{doneCount}</span>
            <span className="text-[#A1A1AA]"> / </span>
            <span className="font-mono-dj">{queueRef.current.length}</span>
            <span className="text-[#52525B]"> · {currentName}</span>
          </span>
          <div className="flex-1 h-1.5 bg-black/60 rounded overflow-hidden border border-white/5">
            <div
              className="h-full bg-gradient-to-r from-[#FF9500] to-[#FF1F1F] transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <button
            data-testid="precache-pause"
            onClick={togglePause}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-white/15 text-[10px] tracking-[0.22em] uppercase font-bold text-[#A1A1AA] hover:text-white hover:border-white/40 transition"
          >
            {pausedFlag ? <><Play className="w-3 h-3" /> Resume</> : <><Pause className="w-3 h-3" /> Pause</>}
          </button>
          <button
            data-testid="precache-stop"
            onClick={stop}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-white/15 text-[10px] tracking-[0.22em] uppercase font-bold text-[#A1A1AA] hover:text-[#FF1F1F] hover:border-[#FF1F1F] transition"
          >
            <Square className="w-3 h-3" /> Stop
          </button>
        </>
      )}
    </div>
  );
}
