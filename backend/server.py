from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError, NoCredentialsError

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
    return boto3.client(
        's3',
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )


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
            name = key.split('/')[-1]
            # strip extension for title
            title = name.rsplit('.', 1)[0]
            tracks.append({
                "key": key,
                "name": title,
                "artist": "",
                "url": None,  # resolved via /api/tracks/url
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


class SavedMixCreate(BaseModel):
    name: str
    duration_seconds: float
    notes: Optional[str] = ""


@api_router.get("/")
async def root():
    return {
        "app": "DJ Lab",
        "brand": "NU Vibe / DJsandMCMedia",
        "s3_configured": bool(S3_BUCKET and AWS_ACCESS_KEY_ID),
    }


@api_router.get("/tracks", response_model=List[Track])
async def list_tracks(source: Optional[str] = Query(None, description="'s3' | 'demo' | None (all)")):
    """List available tracks. Merges S3 library (if configured) + demo tracks."""
    result: List[dict] = []
    if source in (None, "s3"):
        try:
            s3_tracks = await run_in_threadpool(_list_s3_tracks)
            result.extend(s3_tracks)
        except (ClientError, NoCredentialsError) as e:
            logger.warning(f"S3 listing failed: {e}")
    if source in (None, "demo"):
        result.extend(DEMO_TRACKS)
    return result


@api_router.get("/tracks/url")
async def get_track_url(key: str = Query(...), expires: int = Query(3600, ge=60, le=86400)):
    """Return a playable URL for a given track key.
    - For demo tracks: returns the public URL directly.
    - For S3 tracks: returns a presigned URL."""
    demo = next((t for t in DEMO_TRACKS if t["key"] == key), None)
    if demo:
        return {"url": demo["url"], "key": key, "expires_in": 0, "source": "demo"}

    if S3_PREFIX and not key.startswith(S3_PREFIX):
        # allow if no prefix configured
        pass

    try:
        url = await run_in_threadpool(_presign, key, expires)
        return {"url": url, "key": key, "expires_in": expires, "source": "s3"}
    except HTTPException:
        raise
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"S3 error: {e}")


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


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
