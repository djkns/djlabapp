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
- AzuraCast "Now Playing" metadata push (`/api/stream/metadata`)
- FX Rack expansion (Filter Sweep, Bitcrush, Echo Out)

### P2 — Backlog
- Pad Mode tabs (Hot Cue / Loop Roll / Sampler)
- Cloud export of recorded mixes back to S3 `mixes/`
- True reverse-audio scratch (deferred — UX risk)

### Refactoring
- Break down `Deck.jsx` (>800 lines) — extract playback hooks

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
