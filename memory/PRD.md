# DJ Lab — Product Requirements

## Original Problem Statement
Build a DJ Web App called **DJ Lab** — part of The NU Vibe / DJsandMCMedia ecosystem.

### MVP Features
- Two decks with spinning vinyl
- Wavesurfer.js waveforms
- Load tracks, play/pause/cue
- Crossfader, channel volume, 3-band EQ
- Tempo slider with sync
- Record mix
- WebMIDI mapping (specifically tuned for Hercules T7)
- S3 bucket integration for track library
- Professional DJ aesthetic matching the hardware
- Live streaming support to AzuraCast/Icecast

## Architecture
- **Frontend**: React + Vite, Zustand (persisted state), TailwindCSS, `react-window`
- **Audio**: Native HTML5 Web Audio API. `web-audio-beat-detector` for BPM. `jsmediatags` for ID3.
- **Streaming**: Browser MediaRecorder → WebSocket → FastAPI → ffmpeg → AzuraCast/Icecast (HTTP PUT).
- **Hardware**: WebMIDI two-way (Input + Output LEDs).
- **Backend**: FastAPI + MongoDB
- **Storage**: AWS S3 for track library

## Recent (Feb 2026)
- **P0 FIX — Blank waveform on second deck (RESOLVED, 4th recurrence)** verified by iteration_4.json (9/9 PASS including exact bug repro):
  - **Root cause** (via troubleshoot agent): wavesurfer v7's `"ready"` event fires after audio decode but BEFORE canvas paint (`"redraw"`). The cached-path branch returned early after `await wsLoaded` when `getDuration() >= 0.5` was true — the canvas was still blank because `redraw` hadn't fired yet.
  - **Fix**: both cached-path and non-cached-path branches in `Deck.jsx loadTrack` now ALWAYS call `wsRef.current.load(playUrl, peaks, buf.duration)` from a decoded `AudioBuffer`. That path paints the canvas synchronously, eliminating the race entirely. Playhead and play-state are preserved across the forced re-load.
  - Buffer reuse via `wsRef.current.getDecodedData()` avoids a redundant fetch when wavesurfer already has it.

- **Hot cue MOVE simplified** (Feb 2026):
  - **Plain drag** on a marker now repositions it (no Shift/Alt required). Plain click without movement still seeks. Double-click + right-click still delete. Drag threshold 4px so a tap doesn't accidentally move.

- **Smart sync (half/double aware)** (Feb 2026):
  - Sync now evaluates 1×, ÷2, ×2 candidates and picks whichever fits within ±tempoRange and lands closest to the follower's natural BPM. Solves the classic 82↔164 BPM detector confusion. Toast shows `÷2` or `×2` when half/double matching kicks in.
  - **÷2 / ×2 BPM buttons** added next to each deck's BPM input for one-click correction of misdetected tempos.

- **Headphone flow rebuilt to T7 spec** (Feb 2026):
  - **CUE auto-enables HP** the first time it's pressed (no more dead phones).
  - **MIX knob**: linear blend, **LEFT = full CUE / RIGHT = full MASTER**, default to MASTER. Label `CUE ← → MSTR` on a single line.
  - **MASTER button** (PFL Master per T7 manual): toggles whether master is in the HP path at all.
  - **SPLIT button**: routes L=cue / R=master via `ChannelMerger` for per-ear monitoring. Click-free crossfade between blend and split paths via parallel out-gains.

- **Hot-cue marker delete UX** (Feb 2026):
  - Double-click marker → delete. Right-click → delete (fallback). Removed the fiddly × badge.

## Implemented (as of Apr 2026)
- Two decks, picture-disc spinning vinyl
- Wavesurfer waveforms with cue point markers
- Crossfader, channel volume, 3-band EQ, tempo
- Auto-BPM detection (`web-audio-beat-detector`, dual algorithm)
- **Auto musical key detection (Krumhansl-Schmuckler) + Camelot wheel mapping**
- **BPM + Camelot Compatibility HUD** (between header and decks; HARMONIC / ENERGY / CLASH)
- MongoDB cache for `track_meta` (BPM, musical_key, hot_cues, ID3 tags, last_played, play_count)
- ID3 tag reading from S3 streams (jsmediatags) with album art on vinyl
- Library: virtualized with react-window, drag-to-deck
- Recently Played panels (now in TrackLibrary as tabs: Library | Recent A | Recent B)
- WebMIDI mapping with Export/Import + LED feedback for Hercules T7
- Loop In / Loop Out discrete MIDI mappings
- T7-style Headphone mixer (CUE MIX, MASTER button, HP VOL)
- Mic input (with echoCancellation/AGC/NS disabled)
- MP3/WAV recording + export
- Icecast/AzuraCast streaming via ffmpeg subprocess
- Compact header (h-12) — crossfader fully visible

## Code Layout
```
/app/
├── backend/
│   ├── server.py          # FastAPI, S3 proxy, track_meta CRUD, ffmpeg pipe
│   └── .env               # S3, AzuraCast creds
└── frontend/
    └── src/
        ├── App.css / index.css
        ├── lib/
        │   ├── audioEngine.js       # Web Audio routing, FX chains
        │   ├── midi.js              # WebMIDI wrapper
        │   ├── mediaTags.js         # jsmediatags wrapper
        │   ├── streamService.js     # WebSocket pipe
        │   └── keyDetect.js         # Krumhansl-Schmuckler key detection + Camelot
        ├── store/djStore.js          # Zustand
        ├── components/dj/
        │   ├── Header.jsx (h-12)
        │   ├── BpmKeyHud.jsx        # NEW — BPM + Camelot compatibility HUD
        │   ├── Deck.jsx
        │   ├── Mixer.jsx
        │   ├── TrackLibrary.jsx     # Tabs: Library / Recent A / Recent B
        │   ├── RecentlyPlayed.jsx
        │   ├── MidiPanel.jsx, LedFeedback.jsx, SpinningVinyl.jsx
        │   └── ...
        └── pages/DJLab.jsx
```

## Roadmap
### P1 — High value, pending
- FX Rack expansion (Filter Sweep, Bitcrush, Echo Out)
- ✅ AzuraCast "Now Playing" metadata push (shipped Apr 2026)

### P2 — Backlog
- Pad Mode tabs (Hot Cue / Loop Roll / Sampler)
- Cloud Export — BYOK destinations (Dropbox / GDrive / OneDrive) for other DJs (deferred until ready to onboard others)
- PWA install (deferred — until app feels final)
- True reverse-audio scratch (deferred — UX risk)

### Known Limitations
- **Scratch audio fidelity**: Implemented a hybrid AudioBufferSourceNode scratch engine alongside the HTML5 `<audio>` playback path (Apr 2026 session) — pre-decodes each loaded track into forward + sample-reversed buffers, fires short slices on jog ticks while the platter is touched. The implementation works mechanically but the resulting audio doesn't reach professional DJ-platform fidelity (Rekordbox / Serato / Virtual DJ). Code retained for reference and future iteration. Pitch-bend mode (subtle BPM nudge when the wheel turns without a touch) works correctly. Higher fidelity will require either a WASM-based scratch DSP, a proper rate-controlled streaming buffer node, or a desktop-native rewrite.

- **Hercules T7 physical motor control** (Apr 2026): The T7 has motorized 7" platters. Making them physically spin from DJ Lab requires sending the T7's proprietary motor-control MIDI command. Hercules has not publicly documented this command, and no open-source community mapping has published it either. VirtualDJ and DJUCED ship the command internally as a compiled-in abstraction (`ns7_platter` in VDJ's editor is a high-level function, not raw MIDI). On-screen vinyl rotation works correctly at 33⅓ RPM; jog wheel IN still receives perfectly. Path to unblock: MIDI Monitor capture while DJUCED/VDJ plays a track → extract the wire-level bytes. Alternative: dev-relations request to Hercules for the MIDI implementation chart.

### Refactoring
- Break down `Deck.jsx` (>1200 lines) — extract jog engine + load pipeline into hooks

## Critical Notes
- **Audio performance**: Do NOT set `latencyHint: "interactive"` on AudioContext (causes UI lag).
- **Streaming**: ffmpeg HTTP PUT to `/` mount point on port 8005. Don't modify packing.
- **State flushing**: `flushDJStore()` writes localStorage immediately (no debounce) to preserve MIDI mappings on quick reloads.
- **Scrollbars**: `index.css` overrides `::-webkit-scrollbar` — don't add `scrollbar-width: thin`.

## Key API Endpoints
- `GET /api/tracks` — S3 + Mongo cached BPM/key/tags
- `GET /api/tracks/url` — presigned S3 URL
- `GET/POST /api/tracks/meta` — cache CRUD (now includes `musical_key`)
- `POST /api/tracks/played` — bumps play count and last-played per deck
- `GET /api/tracks/recent?deck=A|B` — per-deck history
- `WS /api/ws/stream` — live audio pipe

## DB Schema
- `mixes`: { id, name, duration, notes, tracks_used }
- `track_meta`: { key, bpm, **musical_key**, hot_cues, title, artist, album, cover, last_played, last_played_deckA/B, play_count }
