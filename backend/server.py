from fastapi import FastAPI, APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import subprocess
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
import requests

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# S3 config (optional — gracefully falls back to demo tracks if not configured)
AWS_ACCESS_KEY_ID = os.environ.get('AWS_ACCESS_KEY_ID')
AWS_SECRET_ACCESS_KEY = os.environ.get('AWS_SECRET_ACCESS_KEY')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
S3_BUCKET = os.environ.get('S3_BUCKET')
S3_PREFIX = os.environ.get('S3_PREFIX', '')
S3_ENDPOINT_URL = os.environ.get('S3_ENDPOINT_URL')  # non-empty for S3-compatible providers (Linode, Wasabi, B2, R2)

AUDIO_EXTENSIONS = ('.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac')

# Seeded demo library (royalty-free SoundHelix tracks with proper CORS + direct mp3)
DEMO_TRACKS = [
    {
        "key": "demo-1",
        "name": "SoundHelix Song 1",
        "artist": "T. Schürger",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        "bpm": 120,
        "source": "demo",
    },
    {
        "key": "demo-2",
        "name": "SoundHelix Song 2",
        "artist": "T. Schürger",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
        "bpm": 128,
        "source": "demo",
    },
    {
        "key": "demo-3",
        "name": "SoundHelix Song 3",
        "artist": "T. Schürger",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
        "bpm": 110,
        "source": "demo",
    },
    {
        "key": "demo-4",
        "name": "SoundHelix Song 5",
        "artist": "T. Schürger",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
        "bpm": 124,
        "source": "demo",
    },
    {
        "key": "demo-6",
        "name": "SoundHelix Song 7",
        "artist": "T. Schürger",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3",
        "bpm": 118,
        "source": "demo",
    },
    {
        "key": "demo-8",
        "name": "SoundHelix Song 9",
        "artist": "T. Schürger",
        "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3",
        "bpm": 132,
        "source": "demo",
    },
]


def get_s3_client():
    if not (AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY and S3_BUCKET):
        return None
    kwargs = {
        "region_name": AWS_REGION,
        "aws_access_key_id": AWS_ACCESS_KEY_ID,
        "aws_secret_access_key": AWS_SECRET_ACCESS_KEY,
    }
    if S3_ENDPOINT_URL:
        kwargs["endpoint_url"] = S3_ENDPOINT_URL
    return boto3.client('s3', **kwargs)


def _clean_filename(raw: str) -> str:
    """01_-_brown_sugar -> 01 - brown sugar"""
    s = raw.replace("_-_", " - ").replace("_", " ").strip()
    # collapse double spaces
    return " ".join(s.split())


def _clean_folder(raw: str) -> str:
    """100-greatest-neo-soul-songs -> 100 greatest neo soul songs"""
    s = raw.replace("_", " ").replace("-", " ").strip()
    return " ".join(s.split())


def _list_s3_tracks():
    s3 = get_s3_client()
    if not s3:
        return []
    tracks = []
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=S3_PREFIX):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if key.endswith('/'):
                continue
            if not any(key.lower().endswith(ext) for ext in AUDIO_EXTENSIONS):
                continue
            parts = key.split('/')
            filename = parts[-1]
            folder = parts[-2] if len(parts) > 1 else ""
            title_raw = filename.rsplit('.', 1)[0]
            title = _clean_filename(title_raw)
            album = _clean_folder(folder) if folder else ""
            tracks.append({
                "key": key,
                "name": title,
                "artist": "",
                "album": album,
                "url": None,
                "bpm": None,
                "source": "s3",
                "size": obj['Size'],
            })
    return tracks


def _presign(key: str, expires: int = 3600):
    s3 = get_s3_client()
    if not s3:
        raise HTTPException(status_code=503, detail="S3 not configured")
    return s3.generate_presigned_url(
        'get_object',
        Params={'Bucket': S3_BUCKET, 'Key': key},
        ExpiresIn=expires,
        HttpMethod='GET',
    )


app = FastAPI(title="DJ Lab API")
api_router = APIRouter(prefix="/api")


# Models
class Track(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key: str
    name: str
    artist: Optional[str] = ""
    album: Optional[str] = ""
    url: Optional[str] = None
    bpm: Optional[float] = None
    source: str = "demo"


class SavedMix(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    duration_seconds: float
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    notes: Optional[str] = ""
    tracks_used: Optional[List[dict]] = []


class SavedMixCreate(BaseModel):
    name: str
    duration_seconds: float
    notes: Optional[str] = ""
    tracks_used: Optional[List[dict]] = []


class TrackMeta(BaseModel):
    """Cached per-track analysis (BPM, key) and per-track user data (hot cues)."""
    model_config = ConfigDict(extra="ignore")
    key: str
    bpm: Optional[float] = None
    musical_key: Optional[str] = None
    hot_cues: Optional[List[Optional[float]]] = None
    updated_at: Optional[datetime] = None


class TrackMetaUpsert(BaseModel):
    key: str
    bpm: Optional[float] = None
    musical_key: Optional[str] = None
    hot_cues: Optional[List[Optional[float]]] = None


@api_router.get("/")
async def root():
    return {
        "app": "DJ Lab",
        "brand": "NU Vibe / DJsandMCMedia",
        "s3_configured": bool(S3_BUCKET and AWS_ACCESS_KEY_ID),
    }


@api_router.get("/tracks", response_model=List[Track])
async def list_tracks(source: Optional[str] = Query(None, description="'s3' | 'demo' | None (all)")):
    """List available tracks. Merges S3 library (if configured) + demo tracks.
    BPM is inlined from the `track_meta` cache when available so the library shows
    BPM without re-analyzing on every page load."""
    result: List[dict] = []
    if source in (None, "s3"):
        try:
            s3_tracks = await run_in_threadpool(_list_s3_tracks)
            result.extend(s3_tracks)
        except (ClientError, NoCredentialsError) as e:
            logger.warning(f"S3 listing failed: {e}")
    if source in (None, "demo"):
        result.extend(DEMO_TRACKS)

    # Inline cached BPMs (one round-trip)
    keys = [t["key"] for t in result if not t.get("bpm")]
    if keys:
        cached = await db.track_meta.find(
            {"key": {"$in": keys}},
            {"_id": 0, "key": 1, "bpm": 1},
        ).to_list(len(keys))
        bpm_by_key = {c["key"]: c.get("bpm") for c in cached}
        for t in result:
            if not t.get("bpm") and bpm_by_key.get(t["key"]) is not None:
                t["bpm"] = bpm_by_key[t["key"]]
    return result


@api_router.get("/tracks/meta", response_model=TrackMeta)
async def get_track_meta(key: str = Query(...)):
    """Return cached metadata (BPM, etc.) for a single track key."""
    doc = await db.track_meta.find_one({"key": key}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="No cached metadata")
    if isinstance(doc.get("updated_at"), str):
        doc["updated_at"] = datetime.fromisoformat(doc["updated_at"])
    return doc


@api_router.post("/tracks/meta", response_model=TrackMeta)
async def upsert_track_meta(payload: TrackMetaUpsert):
    """Cache analysis result (BPM, key, etc.) for a track. Idempotent upsert by key."""
    update: dict = {"key": payload.key, "updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.bpm is not None:
        update["bpm"] = round(payload.bpm, 2)
    if payload.musical_key is not None:
        update["musical_key"] = payload.musical_key
    if payload.hot_cues is not None:
        # Normalise length 8, clip negatives
        cues = list(payload.hot_cues)[:8]
        while len(cues) < 8:
            cues.append(None)
        update["hot_cues"] = [None if c is None else round(max(0.0, float(c)), 3) for c in cues]
    await db.track_meta.update_one(
        {"key": payload.key},
        {"$set": update},
        upsert=True,
    )
    doc = await db.track_meta.find_one({"key": payload.key}, {"_id": 0})
    if isinstance(doc.get("updated_at"), str):
        doc["updated_at"] = datetime.fromisoformat(doc["updated_at"])
    return doc


@api_router.get("/tracks/url")
async def get_track_url(key: str = Query(...), expires: int = Query(3600, ge=60, le=86400)):
    """Return a playable URL for a given track key.
    For both demo and S3, returns our /api/tracks/stream proxy URL so the browser's
    Web Audio API (which requires crossOrigin='anonymous' + CORS) can always decode it."""
    demo = next((t for t in DEMO_TRACKS if t["key"] == key), None)
    if demo:
        return {"url": f"/api/tracks/stream?key={key}", "key": key, "expires_in": 0, "source": "demo"}

    if not (AWS_ACCESS_KEY_ID and S3_BUCKET):
        raise HTTPException(status_code=404, detail="Track not found")

    # For S3, the proxy will sign internally — return a short-lived stream URL
    import urllib.parse as _u
    return {
        "url": f"/api/tracks/stream?key={_u.quote(key, safe='')}",
        "key": key,
        "expires_in": expires,
        "source": "s3",
    }


@api_router.get("/tracks/stream")
async def stream_track(key: str = Query(...), request: Request = None):
    """Range-aware CORS-safe proxy for BOTH demo and S3 tracks."""
    demo = next((t for t in DEMO_TRACKS if t["key"] == key), None)

    if demo:
        upstream = demo["url"]
    else:
        # S3 presigned URL (server-internal; browser never sees it)
        if not (AWS_ACCESS_KEY_ID and S3_BUCKET):
            raise HTTPException(status_code=404, detail="Track not found")
        try:
            upstream = await run_in_threadpool(_presign, key, 3600)
        except ClientError as e:
            raise HTTPException(status_code=500, detail=f"S3 error: {e}")

    range_header = request.headers.get("range") if request else None
    headers = {"User-Agent": "DJLab/1.0"}
    if range_header:
        headers["Range"] = range_header

    def _fetch():
        return requests.get(upstream, headers=headers, stream=True, timeout=30)

    upstream_resp = await run_in_threadpool(_fetch)
    if upstream_resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Upstream {upstream_resp.status_code}")

    passthrough = {}
    for h in ("Content-Length", "Content-Range", "Accept-Ranges", "Content-Type", "Last-Modified", "ETag"):
        if h in upstream_resp.headers:
            passthrough[h] = upstream_resp.headers[h]
    passthrough.setdefault("Accept-Ranges", "bytes")
    passthrough.setdefault("Content-Type", "audio/mpeg")
    passthrough["Cache-Control"] = "public, max-age=3600"
    passthrough["Access-Control-Allow-Origin"] = "*"
    passthrough["Access-Control-Expose-Headers"] = "Content-Length, Content-Range, Accept-Ranges"

    def iter_bytes():
        for chunk in upstream_resp.iter_content(chunk_size=64 * 1024):
            if chunk:
                yield chunk

    return StreamingResponse(
        iter_bytes(),
        status_code=upstream_resp.status_code,
        headers=passthrough,
        media_type=passthrough["Content-Type"],
    )


@api_router.post("/mixes", response_model=SavedMix)
async def save_mix(payload: SavedMixCreate):
    mix = SavedMix(**payload.model_dump())
    doc = mix.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    await db.mixes.insert_one(doc)
    return mix


@api_router.get("/mixes", response_model=List[SavedMix])
async def list_mixes():
    docs = await db.mixes.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for d in docs:
        if isinstance(d.get('created_at'), str):
            d['created_at'] = datetime.fromisoformat(d['created_at'])
    return docs


# -------------------- LIVE STREAM RELAY (Icecast / AzuraCast) --------------------
#
# Pipeline:
#   Browser <MediaRecorder WebM/Opus> --WebSocket bytes--> FastAPI --stdin--> ffmpeg
#   ffmpeg transcodes to MP3 and does HTTP PUT (Icecast2 source) to the target server.
#
# Query params (all required):
#   host, port, mount, user, password, bitrate (kbps int), station_name, genre, description
#
_active_streams: dict[str, subprocess.Popen] = {}


from urllib.parse import quote as urlquote


def _build_icecast_url(user: str, password: str, host: str, port: int, mount: str) -> str:
    # Ensure mount starts with '/'
    m = mount if mount.startswith('/') else '/' + mount
    # URL-encode credentials so characters like $, @, :, # in passwords work.
    u = urlquote(user, safe='')
    p = urlquote(password, safe='')
    return f"icecast://{u}:{p}@{host}:{port}{m}"


@app.websocket("/api/ws/stream")
async def stream_ws(ws: WebSocket):
    """Relay browser WebM/Opus chunks to an Icecast/AzuraCast server via ffmpeg."""
    await ws.accept()

    q = ws.query_params
    host = q.get("host")
    port = q.get("port", "8000")
    mount = q.get("mount", "/live.mp3")
    user = q.get("user", "source")
    password = q.get("password")
    bitrate = q.get("bitrate", "128")
    protocol = q.get("protocol", "icecast")  # 'icecast' or 'shoutcast'
    station_name = q.get("station_name", "DJ Lab · NU Vibe")
    genre = q.get("genre", "Electronic")
    description = q.get("description", "Live mix via DJ Lab")

    if not host or not password:
        await ws.close(code=1008, reason="Missing host or password")
        return

    # AzuraCast / Liquidsoap harbor quirk: Shoutcast/ICY protocol has no
    # separate username field, so per-DJ streamer accounts expect the
    # password to be packed as "dj_username:dj_password". FFmpeg's legacy
    # icecast mode only uses the password from the URL, ignoring the user
    # part, so we merge them server-side.
    effective_password = password
    effective_user = user
    if protocol == "shoutcast" and user and user != "source" and ":" not in password:
        effective_password = f"{user}:{password}"
        effective_user = "source"  # placeholder; ffmpeg's legacy mode ignores it

    url = _build_icecast_url(effective_user, effective_password, host, int(port), mount)
    stream_id = str(uuid.uuid4())

    # ffmpeg reads WebM/Opus from stdin, re-encodes to MP3, pushes to Icecast.
    # NOTE: do NOT force `-f webm` — strict parser rejects the unknown-length
    # EBML elements that browser MediaRecorder emits in live streams.
    # Auto-detect + generous probe buffer + nobuffer lets ffmpeg parse the
    # rolling cluster format.
    ffmpeg_cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "info",
        "-fflags", "+nobuffer+genpts",
        "-probesize", "32K",
        "-analyzeduration", "0",
        "-i", "pipe:0",
        "-c:a", "libmp3lame",
        "-b:a", f"{bitrate}k",
        "-ar", "44100",
        "-ac", "2",
        "-f", "mp3",
        "-content_type", "audio/mpeg",
        "-ice_name", station_name,
        "-ice_genre", genre,
        "-ice_description", description,
    ]
    # Liquidsoap / Shoutcast source harbor uses the legacy ICY protocol, not
    # the modern Icecast 2 HTTP PUT. AzuraCast routes DJ connections through
    # a Liquidsoap harbor on a separate port.
    if protocol == "shoutcast":
        ffmpeg_cmd += ["-legacy_icecast", "1"]
    ffmpeg_cmd.append(url)

    try:
        proc = await asyncio.to_thread(
            lambda: subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        )
    except FileNotFoundError:
        await ws.send_json({"type": "error", "message": "ffmpeg not installed on server"})
        await ws.close(code=1011)
        return

    _active_streams[stream_id] = proc
    # Send a sanitized diagnostic so the user can confirm the target URL is
    # correct without leaking the password.
    safe_url = f"icecast://{effective_user}:****@{host}:{port}{mount if mount.startswith('/') else '/' + mount}"
    await ws.send_json({"type": "connected", "stream_id": stream_id})
    await ws.send_json({"type": "info", "message": f"ffmpeg launched, target: {safe_url} ({protocol}, {bitrate}kbps)"})

    # Catch early ffmpeg crashes (wrong creds, host unreachable, etc.) so the
    # client gets a useful error instead of just a silent disconnect.
    async def watch_for_early_exit():
        await asyncio.sleep(2)
        if proc.poll() is not None:
            try:
                await ws.send_json({
                    "type": "error",
                    "message": f"ffmpeg exited early (code {proc.returncode}). See ffmpeg log above for the cause.",
                })
                await ws.close(code=1011)
            except Exception:
                pass
    early_exit_task = asyncio.create_task(watch_for_early_exit())

    async def pump_stderr():
        """Forward ffmpeg errors back to the client so they can debug."""
        while proc.poll() is None:
            try:
                line = await asyncio.to_thread(proc.stderr.readline)
            except Exception:
                break
            if not line:
                break
            try:
                await ws.send_json({"type": "ffmpeg", "message": line.decode("utf-8", "replace").strip()})
            except Exception:
                break

    stderr_task = asyncio.create_task(pump_stderr())
    bytes_in = 0
    last_progress = asyncio.get_event_loop().time()

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            data = msg.get("bytes")
            if data and proc.stdin:
                try:
                    await asyncio.to_thread(proc.stdin.write, data)
                    bytes_in += len(data)
                    now = asyncio.get_event_loop().time()
                    if now - last_progress > 5:
                        await ws.send_json({"type": "progress", "bytes": bytes_in})
                        last_progress = now
                except BrokenPipeError:
                    await ws.send_json({"type": "error", "message": "ffmpeg closed the pipe — check server creds, host, port"})
                    break
            elif msg.get("text"):
                try:
                    if msg["text"] == "stop":
                        break
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    finally:
        early_exit_task.cancel()
        stderr_task.cancel()
        try:
            if proc.stdin:
                proc.stdin.close()
        except Exception:
            pass
        try:
            proc.terminate()
            await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=5)
        except Exception:
            proc.kill()
        _active_streams.pop(stream_id, None)
        try:
            await ws.close()
        except Exception:
            pass


@api_router.get("/stream/status")
async def stream_status():
    return {"active": len(_active_streams), "stream_ids": list(_active_streams.keys())}


app.include_router(api_router)


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
