import { useEffect, useState } from "react";
import Header from "@/components/dj/Header";
import Deck from "@/components/dj/Deck";
import Mixer from "@/components/dj/Mixer";
import TrackLibrary from "@/components/dj/TrackLibrary";
import DesktopOnlyOverlay from "@/components/dj/DesktopOnlyOverlay";
import { resumeAudioContext } from "@/lib/audioEngine";

export default function DJLab() {
  const [libOpen, setLibOpen] = useState(false);
  const [s3Configured, setS3Configured] = useState(false);
  const [deckChains, setDeckChains] = useState({ deckA: null, deckB: null });

  // Root info
  useEffect(() => {
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/`)
      .then((r) => r.json())
      .then((d) => setS3Configured(!!d.s3_configured))
      .catch(() => {});
  }, []);

  // Once both decks have created their MediaElementSources, expose their chain refs
  // via a registry on window so Mixer can set crossfader gains.
  useEffect(() => {
    const handler = (e) => {
      const { deckId, chain } = e.detail || {};
      if (deckId && chain) {
        setDeckChains((prev) => ({ ...prev, [deckId]: chain }));
      }
    };
    window.addEventListener("dj:chain-ready", handler);
    return () => window.removeEventListener("dj:chain-ready", handler);
  }, []);

  // Safety: resume AudioContext on first user interaction
  useEffect(() => {
    const onFirstTouch = () => {
      resumeAudioContext();
      window.removeEventListener("click", onFirstTouch);
    };
    window.addEventListener("click", onFirstTouch);
    return () => window.removeEventListener("click", onFirstTouch);
  }, []);

  return (
    <>
      <DesktopOnlyOverlay />
      <div
        data-testid="dj-lab-root"
        className="hidden lg:flex flex-col h-screen w-full overflow-hidden bg-[#0A0A0A] text-white font-sans relative"
      >
        {/* Ambient club lighting */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            background:
              "radial-gradient(1000px 500px at 20% 0%, rgba(198,40,0,0.12) 0%, transparent 60%)," +
              "radial-gradient(900px 500px at 80% 100%, rgba(255,59,0,0.08) 0%, transparent 65%)",
          }}
        />

        <Header s3Configured={s3Configured} />

        <main className="flex-1 grid grid-cols-12 gap-4 lg:gap-6 p-4 lg:p-6 pb-20 overflow-hidden relative z-10">
          <section className="col-span-5">
            <Deck id="deckA" label="A" accent="#FF3B00" />
          </section>
          <section className="col-span-2">
            <Mixer deckChains={deckChains} />
          </section>
          <section className="col-span-5">
            <Deck id="deckB" label="B" accent="#FF3B00" />
          </section>
        </main>

        <TrackLibrary open={libOpen} onToggle={() => setLibOpen((v) => !v)} />

        <footer className="fixed top-auto bottom-11 right-6 text-[9px] tracking-[0.25em] uppercase text-[#52525B] pointer-events-none z-40">
          Part of the NU Vibe Network
        </footer>
      </div>
    </>
  );
}
