import { useEffect, useState } from "react";
import Header from "@/components/dj/Header";
import Deck from "@/components/dj/Deck";
import Mixer from "@/components/dj/Mixer";
import TrackLibrary from "@/components/dj/TrackLibrary";
import RecentlyPlayed from "@/components/dj/RecentlyPlayed";
import DesktopOnlyOverlay from "@/components/dj/DesktopOnlyOverlay";
import SaveSetDialog from "@/components/dj/SaveSetDialog";
import SavedSetsDrawer from "@/components/dj/SavedSetsDrawer";
import MidiPanel from "@/components/dj/MidiPanel";
import MidiDispatcher from "@/components/dj/MidiDispatcher";
import PlatterLEDFeedback from "@/components/dj/PlatterLEDFeedback";
import LedFeedback from "@/components/dj/LedFeedback";
import StreamConfigDialog from "@/components/dj/StreamConfigDialog";
import ExportMixDialog from "@/components/dj/ExportMixDialog";
import { resumeAudioContext } from "@/lib/audioEngine";
import { subscribeStreamStatus } from "@/lib/streamService";
import { requestMidi, listMidiInputs, setActiveInput, addStateChangeListener, getActiveInputId } from "@/lib/midi";
import { useDJStore } from "@/store/djStore";

export default function DJLab() {
  const [libOpen, setLibOpen] = useState(false);
  const [s3Configured, setS3Configured] = useState(false);
  const [deckChains, setDeckChains] = useState({ deckA: null, deckB: null });

  const [saveSetOpen, setSaveSetOpen] = useState(false);
  const [saveSetDuration, setSaveSetDuration] = useState(0);
  const [savedSetsOpen, setSavedSetsOpen] = useState(false);
  const [midiOpen, setMidiOpen] = useState(false);
  const [streamOpen, setStreamOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [lastRecording, setLastRecording] = useState(null); // { blob, duration }

  const deckA = useDJStore((s) => s.deckA);
  const deckB = useDJStore((s) => s.deckB);
  const recording = useDJStore((s) => s.recording);
  const [recordElapsed, setRecordElapsed] = useState(0);
  // Sync elapsed seconds from a window event dispatched by the Mixer
  useEffect(() => {
    const h = (e) => setRecordElapsed(e.detail?.elapsed || 0);
    window.addEventListener("dj:record-elapsed", h);
    return () => window.removeEventListener("dj:record-elapsed", h);
  }, []);

  // Capture the finished recording so Export can open it
  useEffect(() => {
    const h = (e) => {
      const { blob, duration } = e.detail || {};
      if (blob) setLastRecording({ blob, duration });
    };
    window.addEventListener("dj:recording-complete", h);
    const openExportH = () => setExportOpen(true);
    window.addEventListener("dj:open-export", openExportH);
    return () => {
      window.removeEventListener("dj:recording-complete", h);
      window.removeEventListener("dj:open-export", openExportH);
    };
  }, []);

  useEffect(() => subscribeStreamStatus((s) => setStreaming(!!s.connected)), []);

  useEffect(() => {
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/`)
      .then((r) => r.json())
      .then((d) => setS3Configured(!!d.s3_configured))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const h = (e) => {
      const { deckId, chain } = e.detail || {};
      if (deckId && chain) setDeckChains((p) => ({ ...p, [deckId]: chain }));
    };
    window.addEventListener("dj:chain-ready", h);
    return () => window.removeEventListener("dj:chain-ready", h);
  }, []);

  useEffect(() => {
    const onFirstTouch = () => {
      resumeAudioContext();
      window.removeEventListener("click", onFirstTouch);
    };
    window.addEventListener("click", onFirstTouch);
    return () => window.removeEventListener("click", onFirstTouch);
  }, []);

  const tracksUsed = [deckA.track, deckB.track].filter(Boolean).map((t) => ({ key: t.key, name: t.name, source: t.source }));

  return (
    <>
      <DesktopOnlyOverlay />
      <MidiDispatcher />
      <PlatterLEDFeedback />
      <LedFeedback />
      <div data-testid="dj-lab-root"
        className="hidden lg:flex flex-col h-screen w-full overflow-hidden bg-[#0A0A0A] text-white font-sans relative">
        <div className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              "radial-gradient(1000px 500px at 20% 0%, rgba(209,10,10,0.12) 0%, transparent 60%)," +
              "radial-gradient(900px 500px at 80% 100%, rgba(255,31,31,0.08) 0%, transparent 65%)",
          }} />

        <Header
          s3Configured={s3Configured}
          onOpenMidi={() => setMidiOpen(true)}
          onOpenSaveSet={() => { setSaveSetDuration(0); setSaveSetOpen(true); }}
          onOpenSavedSets={() => setSavedSetsOpen(true)}
          recording={recording}
          elapsed={recordElapsed}
          onToggleRecord={() => window.dispatchEvent(new CustomEvent("dj:action", { detail: { action: "master.record" } }))}
          onOpenStream={() => setStreamOpen(true)}
          streaming={streaming}
          onOpenExport={() => setExportOpen(true)}
          canExport={!!lastRecording?.blob}
        />

        <main className="flex-1 grid grid-cols-12 gap-3 p-3 overflow-hidden relative z-10 min-h-0"
              style={{ gridTemplateRows: "1fr" }}>
          <section className="col-span-4 flex flex-col min-h-0 h-full overflow-hidden">
            <Deck id="deckA" label="A" accent="#FF1F1F" />
          </section>
          <section className="col-span-4 flex flex-col min-h-0 h-full overflow-hidden">
            <Mixer
              deckChains={deckChains}
              onOpenSaveSet={(duration) => { setSaveSetDuration(duration); setSaveSetOpen(true); }}
              onOpenSavedSets={() => setSavedSetsOpen(true)}
              onOpenMidi={() => setMidiOpen(true)}
            />
          </section>
          <section className="col-span-4 flex flex-col min-h-0 h-full overflow-hidden">
            <Deck id="deckB" label="B" accent="#FF1F1F" />
          </section>
        </main>

        <RecentlyPlayed />

        <TrackLibrary open={libOpen} onToggle={() => setLibOpen((v) => !v)} />

        <footer className="fixed top-auto bottom-3 left-6 text-[9px] tracking-[0.25em] uppercase text-[#52525B] pointer-events-none z-40">
          Part of the NU Vibe Network
        </footer>

        <SaveSetDialog
          open={saveSetOpen}
          onClose={() => setSaveSetOpen(false)}
          defaultDuration={saveSetDuration}
          defaultTracks={tracksUsed}
        />
        <SavedSetsDrawer open={savedSetsOpen} onClose={() => setSavedSetsOpen(false)} />
        <MidiPanel open={midiOpen} onClose={() => setMidiOpen(false)} />
        <StreamConfigDialog open={streamOpen} onClose={() => setStreamOpen(false)} />
        <ExportMixDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          webmBlob={lastRecording?.blob}
          durationSec={lastRecording?.duration}
        />
      </div>
    </>
  );
}
