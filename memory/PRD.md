# DJ Lab — Product Requirements & Build Log

## Original Problem Statement
Build a DJ Web App called "DJ Lab" — part of The NU Vibe / DJsandMCMedia ecosystem.
Stack: React (CRA scaffold) frontend, FastAPI + MongoDB backend,
Web Audio API engine, Wavesurfer.js waveforms, Zustand state, no auth MVP. Design: NU Vibe dark neon
(deep black #0A0A0A, primary glow #C62800, accent glow #FF3B00), Pioneer CDJ / Hercules T7 pro layout.

## User Choices (captured)
- AWS/Linode S3 for track library via **backend proxy** (Linode lacks native CORS → all S3 tracks routed through `/api/tracks/stream`).
- Auto-list all audio in bucket/prefix.
- Recording: WebM (Opus).
- BPM: auto-detect with manual override (manual numeric input per deck is exposed).
- Physical controller: **Hercules DJControl T7 / Inpulse** (WebMIDI).

## Architecture
- `/app/backend/server.py`
  - `GET /api/` → app info + `s3_configured` flag
  - `GET /api/tracks` → list merged S3 + demo tracks
  - `GET /api/tracks/url?key=…` → returns proxy URL (CORS-safe)
  - `GET /api/tracks/stream?key=…&source=…` → range-aware CORS-safe proxy
  - `POST/GET /api/mixes` → persist saved mixes in MongoDB
- `/app/frontend/src/pages/DJLab.jsx` — 3-column layout (Deck A / Mixer / Deck B), Desktop-only overlay, Track Library bottom drawer
- `/app/frontend/src/components/dj/` — `Deck`, `Mixer`, `SpinningVinyl`, `EQKnob`, `HotCuePad`, `LoopControls`, `HeadphoneSection`, `TrackLibrary`, `Header`, `DesktopOnlyOverlay`, `MidiDispatcher`, `MidiPanel`, `SaveSetDialog`, `SavedSetsDrawer`
- `/app/frontend/src/lib/audioEngine.js` — per-deck chain (`MediaElementSource → Trim → EQ(low/mid/high) → ColorFilter → Volume → CrossfadeGain → MasterGain → {destination, MediaStreamDestination}`), master recording via `MediaRecorder`, headphone PFL bus.
- `/app/frontend/src/lib/midi.js` — WebMIDI wrapper. 500ms "Smarter Learn" sampler + 30ms noise debounce + PANIC button.
- `/app/frontend/src/lib/mediaTags.js` — jsmediatags ID3 extraction (album art).
- `/app/frontend/src/store/djStore.js` — Zustand store for decks, crossfader, recording, MIDI mappings, headphone bus state.

## Implemented Features
- [x] Two decks (A/B) with scratchable spinning vinyl + ID3 album art
- [x] Load tracks — drag-drop, file picker, S3 track library (1,725 tracks)
- [x] Play / Pause / Cue per deck
- [x] Wavesurfer.js waveform per deck with click-to-scrub
- [x] Crossfader (equal-power) with glowing trail animation
- [x] Channel volume fader per deck (vertical)
- [x] Trim / 3-band EQ (low/mid/high) / bipolar Color Filter per deck
- [x] Tempo slider ±8% / toggle ±16%, live BPM display, manual base-BPM override
- [x] Sync + Keylock
- [x] 8 Hot Cues per deck (shift+click clears) + Auto-loops (1, 2, 4, 8, 16 beats)
- [x] Master record → `MediaRecorder` → auto-download `.webm`
- [x] Master VU meter (stereo), master volume fader (vertical)
- [x] Beat-pulse glow on deck border
- [x] Headphone PFL bus with output-device selection + mix/volume
- [x] WebMIDI integration — smarter learn, noise debounce, PANIC
- [x] Saved Sets dialog (MongoDB persisted)
- [x] Desktop-only overlay at <1024px
- [x] Hercules T7 layout parity (channel strips match physical layout)
- [x] **Vertical fader modern-Chrome compatibility (FIXED 2026-02-23)**

## Fixed During This Session
- **2026-02-25 — Icecast/AzuraCast streaming finally works (RCA fix).** Five bugs uncovered and fixed in sequence:
  1. **`ffmpeg` was not installed** in the container — installed v5.1.8 with libmp3lame/libopus/librtmp.
  2. **`/api/stream/status` route registered AFTER `app.include_router(api_router)`** — FastAPI silently ignored it. Reordered so all routes (including streaming) are added before include.
  3. **Diagnostics added** — sanitized target URL, byte counter, ffmpeg stderr passthrough, friendly 401/404/connection-refused/DNS messages, early-exit watcher catches ffmpeg crashes within 2s.
  4. **Always pack creds + use `-legacy_icecast 1` unless user explicitly picks Icecast 2** — solves stale-config edge cases.
  5. **Icecast 2 mode now uses `http://` HTTP PUT instead of `icecast://`** — ffmpeg's icecast:// plugin rejects empty mounts ("No mountpoint specified"), but AzuraCast's default streamer mount is literally `/`. Switched to `-method PUT -auth_type basic -content_type audio/mpeg` with `Ice-*` headers. User confirmed end-to-end stream live.
- **2026-02-25 — LED feedback for all controller buttons.** `LedFeedback.jsx` mirrors play/PFL/keylock/loop/FX/hot-cues/HP/mic state to the controller via the same MIDI signature each control was learned with. 5 new MIDI-mappable controls added (keylock × 2, loop × 2, hp.enabled).
- **2026-02-25 — T7-style HP MASTER button.** Cyan-glow toggle in HP column gates master mix into headphone path (matches T7 hardware behavior).
- **2026-02-24 — Persistent BPM + hot cues per track in MongoDB.** `track_meta` collection. Cache hits skip beat-detection. Hot cues survive page reload.
- **2026-02-24 — Auto BPM detection.** `web-audio-beat-detector` dual-algorithm (`analyze` + `guess`) with toast feedback.
- **2026-02-24 — Knob/fader bouncing fixed.** Reverted to simple controlled pattern. Faders restyled to match crossfader. `latencyHint: "interactive"` + DJ-grade mic constraints.
- **2026-02-24 — Knob / fader bouncing (P0).** Reverted `EQKnob.jsx` and `SmoothSlider.jsx` to the simple fully-controlled `value` + `onChange` pattern. The previous hybrid (rAF throttling + `localValue` + `onChangeRef` for knobs; `defaultValue` + `useEffect` imperative-sync for sliders) was fighting React's render cycle and causing visible thumb bounce. Verified in-browser: MID EQ knob rotates smoothly, VOL A fader tracks from 0.8→1.0 without snap-back, crossfader reaches 0.72 from center without bounce.
- **2026-02-23 — Vertical fader rendering in Chrome 124+.** Chrome 124+ removed `-webkit-appearance: slider-vertical`. Replaced with W3C standard `writing-mode: vertical-lr; direction: rtl; appearance: auto`. Verified click/drag working top→bottom.
- **2026-02-23 — Badge clearance.** Added `pb-24` bottom padding on main + `pb-20` on mixer scroll area; moved "Part of the NU Vibe Network" footer to bottom-left so it doesn't collide with Emergent preview badge.
- **2026-02-23 — Deck re-compacted.** Deck height reduced from 516px → 349px (~32% shorter). Changes:
  - Vinyl 120px → 84px
  - Waveform 96px → 64px
  - Transport/Keylock/Tempo/Load merged into single non-wrapping row
  - Hot Cue pad buttons h-9 → h-7
  - Hot Cues + Loop always 2-col grid (removed `md:` breakpoint that stacked at <768px)
  - LOAD button moved inline instead of taking a separate row
  - Meta section inlined: DECK label, source, title, artist, time, BPM all in top flex section
  - Container padding `p-4 gap-3` → `p-3 gap-2`
  - Stable 349px height at 1280, 1440, 1920 viewports.

## Outstanding / Pending
- **MIDI cross-talk (USER VERIFICATION PENDING)** — 500ms sampler + 30ms debounce + PANIC button implemented. Awaiting user confirmation with Hercules T7 / Inpulse.
- **True reverse-scratch audio** — needs `AudioBufferSourceNode` refactor for real backward playback.

## Backlog (Prioritized)
### P1
- Stacked dual-waveform beat grid (Deck A blue / Deck B red, centered playhead)
- FX Rack (Reverb / Delay / Flanger) wired into FX1/FX2 slots

### P2
- Track Library virtual scrolling / pagination (1,725 tracks currently all in DOM)
- Pad Mode tabs (Hot Cue / Loop Roll / Sampler)
- Cloud Export — upload recorded mixes back to `djsandmc-audio/mixes/`
- Refactor `Deck.jsx` (split UI / playback / MIDI subscriptions)

## Build date
2026-02-23 — Vertical fader Chrome-compat fix verified.
