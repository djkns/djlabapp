# DJ Lab — Product Requirements & Build Log

## Original Problem Statement
Build a DJ Web App called "DJ Lab" — part of The NU Vibe / DJsandMCMedia ecosystem.
Stack: React + Vite frontend (implemented on CRA scaffold), FastAPI + MongoDB backend,
Web Audio API engine, Wavesurfer.js waveforms, Zustand state, no auth MVP. Design: NU Vibe dark neon
(deep black #0A0A0A, primary glow #C62800, accent glow #FF3B00), Pioneer CDJ pro layout.

## User Choices (captured)
- AWS S3 for track library with **presigned URLs** (credentials not yet provided → demo mode).
- Auto-list all audio in bucket/prefix.
- Recording: WebM (Opus).
- BPM: auto-detect with manual override (manual numeric input per deck is exposed; auto-detection deferred to post-MVP).
- Post-MVP scaffolding: NOT added (kept MVP clean, per "yes" on defaults).

## Architecture
- `/app/backend/server.py`
  - `GET /api/` → app info + `s3_configured` flag
  - `GET /api/tracks` → list merged S3 + demo tracks (6 SoundHelix demo)
  - `GET /api/tracks/url?key=…` → demo returns `/api/tracks/stream?…` proxy URL; S3 returns presigned GET URL
  - `GET /api/tracks/stream?key=…` → **CORS-safe proxy** for demo tracks (range-aware, streams bytes)
  - `POST/GET /api/mixes` → persist saved mixes in MongoDB (`mixes` collection)
- `/app/frontend/src/pages/DJLab.jsx` — 3-column layout (Deck A / Mixer / Deck B), Desktop-only overlay, Track Library bottom drawer
- `/app/frontend/src/components/dj/` — `Deck`, `Mixer`, `SpinningVinyl`, `EQKnob`, `TrackLibrary`, `Header`, `DesktopOnlyOverlay`
- `/app/frontend/src/lib/audioEngine.js` — shared AudioContext, per-deck chain (`MediaElementSource → LowShelf → Peaking → HighShelf → Volume → CrossfadeGain → MasterGain → {destination, MediaStreamDestination}`), master recording via `MediaRecorder` auto-downloading `.webm` (Opus)
- `/app/frontend/src/store/djStore.js` — Zustand store for both decks + crossfader + recording state

## Implemented Features (MVP)
- [x] Two decks (A/B) side-by-side with spinning vinyl visual
- [x] Load tracks — drag-drop, file picker, track library (S3 + demo)
- [x] Play / Pause / Cue per deck
- [x] Wavesurfer.js waveform per deck with click-to-scrub
- [x] Crossfader (equal-power) with glowing trail animation
- [x] Channel volume fader per deck
- [x] 3-band EQ per deck via BiquadFilter (low/mid/high) + rotary knob UI (drag + double-click reset)
- [x] Tempo slider ±8% / toggle ±16%, live BPM display, manual base-BPM override
- [x] Sync button — matches deck's current BPM to the other deck's current BPM (clamped to range)
- [x] Master record → `MediaRecorder` on master MediaStreamDestination → auto-downloads `.webm`
- [x] Master VU meter (stereo columns), master volume fader
- [x] Beat-pulse glow on deck border, synced to RMS transients
- [x] Desktop-only overlay at <1024px
- [x] Footer: "Part of the NU Vibe Network"
- [x] MongoDB: `POST /api/mixes`, `GET /api/mixes` (ready for Save Set UI)

## Fixed During Testing
- **Critical — CORS on demo tracks**: SoundHelix doesn't return `Access-Control-Allow-Origin`. Added `GET /api/tracks/stream` backend proxy (range-aware + CORS headers). Demo tracks now play through the Web Audio chain.
- Added `data-testid="desktop-only-overlay"` for responsive testing.
- Added user-facing toast on playback failures.
- Reordered `logging.basicConfig` to top of `server.py`.

## Post-MVP Backlog (deferred)
- P0: Wire real S3 credentials (drop keys into `backend/.env`; endpoint contract is ready)
- P1: Hot cues (4–8 per deck)
- P1: Loop in/out + beatgrid
- P1: FX rack (filter, reverb, delay, flanger)
- P1: BPM auto-detection (web-audio-beat-detector)
- P2: Save Sets UI — list + replay saved mixes (`/api/mixes` already implemented)
- P2: Cloud export of recorded mix to S3
- P2: Collab mode via WebSockets
- P2: NU Vibe Radio companion + mobile listener app

## Key Test IDs (for QA/automation)
`dj-lab-root`, `app-header`, `desktop-only-overlay`, `deck-a`, `deck-b`, `deck-a-play`, `deck-a-cue`, `deck-a-sync`, `deck-a-volume`, `deck-a-tempo`, `deck-a-tempo-range`, `deck-a-upload`, `deck-a-waveform`, `deck-a-title`, `deck-a-bpm`, `deck-a-base-bpm`, `deck-a-eq-high`, `deck-a-eq-mid`, `deck-a-eq-low`, (same for `deck-b-*`), `crossfader`, `master-volume`, `record-toggle`, `record-elapsed`, `track-library`, `library-toggle`, `library-search`, `library-row-<key>`, `load-a-<key>`, `load-b-<key>`.

## Build date
2026-02-23 — MVP shipped.
