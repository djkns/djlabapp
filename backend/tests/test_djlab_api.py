"""Backend API tests for DJ Lab."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://djlab-neon.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---- /api/ root
class TestRoot:
    def test_root_returns_app_info(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("app") == "DJ Lab"
        assert "brand" in data
        assert "s3_configured" in data
        assert isinstance(data["s3_configured"], bool)


# ---- /api/tracks
class TestTracks:
    def test_list_tracks_returns_demo(self, api):
        r = api.get(f"{BASE_URL}/api/tracks", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        demo = [t for t in data if t.get("source") == "demo"]
        assert len(demo) == 6, f"Expected 6 demo tracks, got {len(demo)}"
        # Validate shape of each demo track
        for t in demo:
            assert "key" in t and t["key"].startswith("demo-")
            assert "name" in t and isinstance(t["name"], str)
            assert "bpm" in t
            assert t["source"] == "demo"

    def test_list_tracks_source_demo_filter(self, api):
        r = api.get(f"{BASE_URL}/api/tracks?source=demo", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 6
        assert all(t["source"] == "demo" for t in data)


# ---- /api/tracks/url
class TestTrackUrl:
    def test_track_url_demo_returns_soundhelix(self, api):
        r = api.get(f"{BASE_URL}/api/tracks/url", params={"key": "demo-1"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["source"] == "demo"
        assert data["key"] == "demo-1"
        assert "soundhelix.com" in data["url"].lower()

    def test_track_url_missing_key_returns_503_or_500(self, api):
        # S3 is not configured and key is not in demos → should raise 503 (S3 not configured)
        r = api.get(f"{BASE_URL}/api/tracks/url", params={"key": "nonexistent-key"}, timeout=30)
        assert r.status_code in (500, 503), f"Got {r.status_code}: {r.text}"

    def test_track_url_missing_param(self, api):
        r = api.get(f"{BASE_URL}/api/tracks/url", timeout=30)
        assert r.status_code == 422  # FastAPI validation


# ---- /api/mixes
class TestMixes:
    def test_create_and_list_mix_persists(self, api):
        payload = {
            "name": "TEST_mix_pytest",
            "duration_seconds": 123.4,
            "notes": "automated test",
        }
        r = api.post(f"{BASE_URL}/api/mixes", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        created = r.json()
        assert created["name"] == payload["name"]
        assert created["duration_seconds"] == payload["duration_seconds"]
        assert created["notes"] == payload["notes"]
        assert "id" in created
        assert "created_at" in created

        # GET to verify persistence
        r2 = api.get(f"{BASE_URL}/api/mixes", timeout=30)
        assert r2.status_code == 200
        all_mixes = r2.json()
        assert isinstance(all_mixes, list)
        found = [m for m in all_mixes if m.get("id") == created["id"]]
        assert len(found) == 1, "Created mix not found in list"
        assert found[0]["name"] == payload["name"]

    def test_create_mix_validation_error(self, api):
        r = api.post(f"{BASE_URL}/api/mixes", json={"name": "x"}, timeout=30)
        assert r.status_code == 422  # missing duration_seconds
