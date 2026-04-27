/**
 * AzuraCast Now-Playing pusher.
 *
 * Watches the active deck (the one whose volume × crossfader makes it the
 * dominant signal) and POSTs title + artist to AzuraCast whenever:
 *   • the active deck changes,
 *   • the active deck's track changes,
 *   • the user manually invokes pushNow().
 *
 * Pushes are rate-limited (one per 4 seconds at most) and only fire while
 * we believe a live broadcast is in progress (`isStreaming()` from
 * streamService). Outside of a live stream the API timeouts on AzuraCast's
 * end anyway because Liquidsoap has no live source to update.
 */
import { useDJStore } from "@/store/djStore";
import { isStreaming } from "@/lib/streamService";

const API_BASE = process.env.REACT_APP_BACKEND_URL;
const STORAGE_KEY = "djlab.nowPlayingConfig";
const MIN_INTERVAL_MS = 4000;

const DEFAULT_CFG = {
  enabled: false,
  base_url: "djsandmc.media",
  api_key: "",
  station_id: 1,
};

let cfg = null;
let lastPushAt = 0;
let lastPayload = "";
let unsubscribeStore = null;
let pollTimer = null;

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CFG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_CFG;
}

export function saveConfig(next) {
  cfg = { ...DEFAULT_CFG, ...next };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  return cfg;
}

/**
 * Determine which deck is currently the dominant audible source.
 * Logic: deck.volume × crossfader-side-gain. If both are very low,
 * returns null (don't push silence as now-playing).
 */
function pickActiveDeck(state) {
  const cf = state.crossfader ?? 0; // -1 (A) ... +1 (B)
  // Equal-power crossfade approximation
  const aGain = Math.cos(((cf + 1) / 2) * (Math.PI / 2));
  const bGain = Math.cos(((1 - cf) / 2) * (Math.PI / 2));
  const aLevel = (state.deckA.volume ?? 0) * aGain;
  const bLevel = (state.deckB.volume ?? 0) * bGain;
  // Need at least 5% audible level to count as "playing"
  if (aLevel < 0.05 && bLevel < 0.05) return null;
  return aLevel >= bLevel ? "deckA" : "deckB";
}

function activeTrackInfo(state) {
  const deckId = pickActiveDeck(state);
  if (!deckId) return null;
  const t = state[deckId].track;
  if (!t) return null;
  // Fall back to filename-derived name if ID3 missing
  const title = t.name || t.key?.split("/").pop() || "";
  const artist = t.artist || "";
  return { title, artist };
}

async function postNowPlaying(title, artist) {
  if (!cfg) cfg = loadConfig();
  if (!cfg.enabled || !cfg.api_key || !cfg.station_id) return null;
  try {
    const r = await fetch(`${API_BASE}/api/azuracast/nowplaying`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_url: cfg.base_url,
        api_key: cfg.api_key,
        station_id: cfg.station_id,
        title,
        artist,
      }),
    });
    return await r.json();
  } catch (err) {
    console.warn("[nowplaying] push failed", err);
    return null;
  }
}

function maybePush() {
  if (!cfg?.enabled) return;
  if (!isStreaming()) return; // only push during a live broadcast
  const state = useDJStore.getState();
  const info = activeTrackInfo(state);
  if (!info) return;
  const sig = `${info.title}\u0000${info.artist}`;
  if (sig === lastPayload) return;          // no change
  const now = Date.now();
  if (now - lastPushAt < MIN_INTERVAL_MS) return;
  lastPushAt = now;
  lastPayload = sig;
  postNowPlaying(info.title, info.artist);
}

/** Manually push the current active-deck track. Used by the test button. */
export async function pushNow() {
  cfg = loadConfig();
  const state = useDJStore.getState();
  const info = activeTrackInfo(state);
  if (!info) return { status: 400, ok: false, response: "No audible deck — load a track and bring up the volume." };
  const result = await postNowPlaying(info.title, info.artist);
  if (result?.ok) {
    lastPushAt = Date.now();
    lastPayload = `${info.title}\u0000${info.artist}`;
  }
  return result;
}

/**
 * Start watching the store + a periodic re-check (in case streaming-state
 * changes mid-set without a track change). Idempotent.
 */
export function startNowPlayingWatcher() {
  cfg = loadConfig();
  if (unsubscribeStore) return; // already running
  unsubscribeStore = useDJStore.subscribe(maybePush);
  pollTimer = setInterval(maybePush, 5000);
}

export function stopNowPlayingWatcher() {
  if (unsubscribeStore) { unsubscribeStore(); unsubscribeStore = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/** Reload from storage (call after saveConfig). */
export function reloadConfig() {
  cfg = loadConfig();
  lastPayload = ""; // force a fresh push on next change
}
