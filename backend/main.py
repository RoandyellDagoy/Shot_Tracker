from datetime import datetime
from typing import List, Optional, Dict, Any
import os
import sqlite3
import json
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

# Load .env file automatically if present in root or backend directory
for env_candidate in [
    Path(__file__).resolve().parent.parent / ".env",
    Path(__file__).resolve().parent / ".env",
]:
    if env_candidate.exists():
        for line in env_candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/").removesuffix("/rest/v1")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "").strip()

USE_SUPABASE = bool(
    SUPABASE_URL
    and SUPABASE_KEY
    and "your-project-id" not in SUPABASE_URL
    and "your-supabase" not in SUPABASE_KEY
)

app = FastAPI(
    title="HoopsVision AI - Shot & Biomechanics Analytics API",
    description="Hybrid Python FastAPI backend for basketball shot tracking, form biomechanics analysis, and session performance.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(os.getenv("DB_PATH", str(Path(__file__).parent / "shots.db")))


def supabase_request(
    method: str,
    path: str,
    body: Optional[Any] = None,
    prefer: str = "return=representation",
) -> Any:
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": prefer,
    }
    # Legacy JWT keys start with 'eyJ' and use Bearer auth; new 'sb_publishable_' / 'sb_secret_' keys use 'apikey' header
    if SUPABASE_KEY.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {SUPABASE_KEY}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        raise HTTPException(
            status_code=500,
            detail=f"Supabase error ({e.code}): {err_body}",
        )


def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    if USE_SUPABASE:
        return
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                court_zone_default TEXT DEFAULT 'Top of Key 3',
                shooting_hand TEXT DEFAULT 'Right',
                created_at TEXT NOT NULL,
                notes TEXT DEFAULT ''
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS shots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                made INTEGER NOT NULL,
                court_zone TEXT NOT NULL,
                elbow_angle REAL,
                release_angle REAL,
                knee_angle REAL,
                follow_through_ms INTEGER,
                form_score REAL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
            )
            """
        )
        conn.commit()

        cur.execute("SELECT COUNT(*) as cnt FROM sessions")
        if cur.fetchone()["cnt"] == 0:
            now = datetime.utcnow().isoformat()
            cur.execute(
                "INSERT INTO sessions (title, court_zone_default, shooting_hand, created_at, notes) VALUES (?, ?, ?, ?, ?)",
                ("My Shooting Session #1", "Top of Key 3", "Right", now, ""),
            )
            conn.commit()
        conn.close()
    except Exception:
        # On read-only serverless filesystems when Supabase is not yet set
        pass


def compute_form_score(
    elbow_angle: Optional[float],
    release_angle: Optional[float],
    knee_angle: Optional[float],
    follow_through_ms: Optional[int] = 500,
) -> float:
    """
    Calculates a 0-100 biomechanical shooting form score based on sports science targets:
    - Ideal Set/Load Elbow Angle: ~85° - 95° (90° optimal)
    - Ideal Release Angle (arm elevation): ~50° - 60° (55° optimal)
    - Ideal Knee Bend Angle: ~110° - 125° (118° optimal)
    - Follow-through hold: >= 500ms
    """
    if elbow_angle is None or release_angle is None or knee_angle is None:
        return 75.0

    elbow_penalty = min(35.0, abs(elbow_angle - 90.0) * 1.4)
    release_penalty = min(30.0, abs(release_angle - 55.0) * 1.6)
    knee_penalty = min(25.0, abs(knee_angle - 118.0) * 0.9)
    ft_bonus = 5.0 if (follow_through_ms or 0) >= 550 else 0.0

    raw = 100.0 - elbow_penalty - release_penalty - knee_penalty + ft_bonus
    return round(max(10.0, min(100.0, raw)), 1)


class SessionCreate(BaseModel):
    title: str = Field(default="Live Shooting Session")
    court_zone_default: str = Field(default="Top of Key 3")
    shooting_hand: str = Field(default="Right")
    notes: str = Field(default="")


class ShotCreate(BaseModel):
    made: bool
    court_zone: str = Field(default="Top of Key 3")
    elbow_angle: Optional[float] = None
    release_angle: Optional[float] = None
    knee_angle: Optional[float] = None
    follow_through_ms: Optional[int] = 500


@app.on_event("startup")
def on_startup():
    init_db()


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "storage": "Supabase PostgreSQL" if USE_SUPABASE else "Local SQLite",
        "engine": "FastAPI Biomechanics Analytics v1.0",
    }


@app.get("/api/sessions")
def list_sessions():
    if USE_SUPABASE:
        sessions = supabase_request("GET", "sessions?select=*&order=id.desc")
        all_shots = supabase_request("GET", "shots?select=*&order=id.asc")
        shots_by_session: Dict[int, List[Dict[str, Any]]] = {}
        for sh in all_shots:
            shots_by_session.setdefault(sh["session_id"], []).append(sh)

        for s in sessions:
            shots = shots_by_session.get(s["id"], [])
            total = len(shots)
            makes = sum(1 for sh in shots if sh["made"] == 1)
            s["total_shots"] = total
            s["makes"] = makes
            s["misses"] = total - makes
            s["fg_pct"] = round((makes / total) * 100, 1) if total > 0 else 0.0
            s["avg_form_score"] = (
                round(sum(sh["form_score"] or 0 for sh in shots) / total, 1)
                if total > 0
                else 0.0
            )
            s["shots"] = shots
        return sessions

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM sessions ORDER BY id DESC")
    sessions = [dict(r) for r in cur.fetchall()]

    for s in sessions:
        cur.execute("SELECT * FROM shots WHERE session_id = ? ORDER BY id ASC", (s["id"],))
        shots = [dict(r) for r in cur.fetchall()]
        total = len(shots)
        makes = sum(1 for sh in shots if sh["made"] == 1)
        s["total_shots"] = total
        s["makes"] = makes
        s["misses"] = total - makes
        s["fg_pct"] = round((makes / total) * 100, 1) if total > 0 else 0.0
        s["avg_form_score"] = (
            round(sum(sh["form_score"] or 0 for sh in shots) / total, 1) if total > 0 else 0.0
        )
        s["shots"] = shots

    conn.close()
    return sessions


@app.post("/api/sessions")
def create_session(payload: SessionCreate):
    now = datetime.utcnow().isoformat()
    if USE_SUPABASE:
        created = supabase_request(
            "POST",
            "sessions",
            {
                "title": payload.title,
                "court_zone_default": payload.court_zone_default,
                "shooting_hand": payload.shooting_hand,
                "notes": payload.notes,
            },
        )
        row = created[0] if isinstance(created, list) and created else {"id": 1}
        return {
            "id": row["id"],
            "title": payload.title,
            "court_zone_default": payload.court_zone_default,
            "shooting_hand": payload.shooting_hand,
            "created_at": row.get("created_at", now),
            "notes": payload.notes,
            "total_shots": 0,
            "makes": 0,
            "misses": 0,
            "fg_pct": 0.0,
            "avg_form_score": 0.0,
            "shots": [],
        }

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO sessions (title, court_zone_default, shooting_hand, created_at, notes) VALUES (?, ?, ?, ?, ?)",
        (payload.title, payload.court_zone_default, payload.shooting_hand, now, payload.notes),
    )
    session_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {
        "id": session_id,
        "title": payload.title,
        "court_zone_default": payload.court_zone_default,
        "shooting_hand": payload.shooting_hand,
        "created_at": now,
        "notes": payload.notes,
        "total_shots": 0,
        "makes": 0,
        "misses": 0,
        "fg_pct": 0.0,
        "avg_form_score": 0.0,
        "shots": [],
    }


@app.post("/api/sessions/{session_id}/shots")
def log_shot(session_id: int, payload: ShotCreate):
    now = datetime.utcnow().isoformat()
    form_score = compute_form_score(
        payload.elbow_angle,
        payload.release_angle,
        payload.knee_angle,
        payload.follow_through_ms,
    )

    if USE_SUPABASE:
        created = supabase_request(
            "POST",
            "shots",
            {
                "session_id": session_id,
                "made": 1 if payload.made else 0,
                "court_zone": payload.court_zone,
                "elbow_angle": payload.elbow_angle,
                "release_angle": payload.release_angle,
                "knee_angle": payload.knee_angle,
                "follow_through_ms": payload.follow_through_ms,
                "form_score": form_score,
            },
        )
        row = created[0] if isinstance(created, list) and created else {}
        return {
            "id": row.get("id", 1),
            "session_id": session_id,
            "made": 1 if payload.made else 0,
            "court_zone": payload.court_zone,
            "elbow_angle": payload.elbow_angle,
            "release_angle": payload.release_angle,
            "knee_angle": payload.knee_angle,
            "follow_through_ms": payload.follow_through_ms,
            "form_score": form_score,
            "created_at": row.get("created_at", now),
        }

    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
    if not cur.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Session not found")

    cur.execute(
        """
        INSERT INTO shots (session_id, made, court_zone, elbow_angle, release_angle, knee_angle, follow_through_ms, form_score, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            1 if payload.made else 0,
            payload.court_zone,
            payload.elbow_angle,
            payload.release_angle,
            payload.knee_angle,
            payload.follow_through_ms,
            form_score,
            now,
        ),
    )
    shot_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {
        "id": shot_id,
        "session_id": session_id,
        "made": 1 if payload.made else 0,
        "court_zone": payload.court_zone,
        "elbow_angle": payload.elbow_angle,
        "release_angle": payload.release_angle,
        "knee_angle": payload.knee_angle,
        "follow_through_ms": payload.follow_through_ms,
        "form_score": form_score,
        "created_at": now,
    }


@app.delete("/api/shots/{shot_id}")
def delete_shot(shot_id: int):
    if USE_SUPABASE:
        supabase_request("DELETE", f"shots?id=eq.{shot_id}")
        return {"deleted": shot_id}

    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM shots WHERE id = ?", (shot_id,))
    conn.commit()
    conn.close()
    return {"deleted": shot_id}


@app.post("/api/reset")
def reset_all_data():
    if USE_SUPABASE:
        supabase_request("DELETE", "shots?id=gt.0")
        supabase_request("DELETE", "sessions?id=gt.0")
        supabase_request(
            "POST",
            "sessions",
            {
                "title": "My Shooting Session #1",
                "court_zone_default": "Top of Key 3",
                "shooting_hand": "Right",
                "notes": "",
            },
        )
        return {"status": "reset_complete"}

    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM shots")
    cur.execute("DELETE FROM sessions")
    now = datetime.utcnow().isoformat()
    cur.execute(
        "INSERT INTO sessions (title, court_zone_default, shooting_hand, created_at, notes) VALUES (?, ?, ?, ?, ?)",
        ("My Shooting Session #1", "Top of Key 3", "Right", now, ""),
    )
    conn.commit()
    conn.close()
    return {"status": "reset_complete"}


def avg_metric(shots: List[Dict[str, Any]], key: str) -> Optional[float]:
    vals = [s[key] for s in shots if s.get(key) is not None]
    return round(sum(vals) / len(vals), 1) if vals else None


@app.get("/api/analytics/summary")
def get_analytics_summary(session_id: Optional[int] = None):
    if USE_SUPABASE:
        if session_id:
            shots = supabase_request(
                "GET", f"shots?session_id=eq.{session_id}&select=*&order=id.asc"
            )
        else:
            shots = supabase_request("GET", "shots?select=*&order=id.asc")
    else:
        conn = get_db()
        cur = conn.cursor()
        if session_id:
            cur.execute("SELECT * FROM shots WHERE session_id = ? ORDER BY id ASC", (session_id,))
        else:
            cur.execute("SELECT * FROM shots ORDER BY id ASC")
        shots = [dict(r) for r in cur.fetchall()]
        conn.close()

    total = len(shots)
    makes_list = [s for s in shots if s["made"] == 1]
    misses_list = [s for s in shots if s["made"] == 0]
    makes = len(makes_list)
    misses = len(misses_list)
    fg_pct = round((makes / total) * 100, 1) if total > 0 else 0.0

    # Zone breakdown
    zones: Dict[str, Dict[str, Any]] = {}
    for s in shots:
        z = s["court_zone"]
        if z not in zones:
            zones[z] = {"zone": z, "attempts": 0, "makes": 0, "fg_pct": 0.0, "avg_form": 0.0, "_forms": []}
        zones[z]["attempts"] += 1
        if s["made"] == 1:
            zones[z]["makes"] += 1
        if s.get("form_score") is not None:
            zones[z]["_forms"].append(s["form_score"])

    zone_stats = []
    for z, data in zones.items():
        data["fg_pct"] = round((data["makes"] / data["attempts"]) * 100, 1)
        data["avg_form"] = round(sum(data["_forms"]) / len(data["_forms"]), 1) if data["_forms"] else 0.0
        del data["_forms"]
        zone_stats.append(data)

    # Biomechanics comparison: Makes vs Misses
    biomechanics = {
        "makes": {
            "elbow_angle": avg_metric(makes_list, "elbow_angle"),
            "release_angle": avg_metric(makes_list, "release_angle"),
            "knee_angle": avg_metric(makes_list, "knee_angle"),
            "follow_through_ms": avg_metric(makes_list, "follow_through_ms"),
            "form_score": avg_metric(makes_list, "form_score"),
        },
        "misses": {
            "elbow_angle": avg_metric(misses_list, "elbow_angle"),
            "release_angle": avg_metric(misses_list, "release_angle"),
            "knee_angle": avg_metric(misses_list, "knee_angle"),
            "follow_through_ms": avg_metric(misses_list, "follow_through_ms"),
            "form_score": avg_metric(misses_list, "form_score"),
        },
        "overall": {
            "elbow_angle": avg_metric(shots, "elbow_angle"),
            "release_angle": avg_metric(shots, "release_angle"),
            "knee_angle": avg_metric(shots, "knee_angle"),
            "follow_through_ms": avg_metric(shots, "follow_through_ms"),
            "form_score": avg_metric(shots, "form_score"),
        },
    }

    # Generate AI Coaching Insights in Python
    insights = []
    m_elbow = biomechanics["makes"]["elbow_angle"]
    x_elbow = biomechanics["misses"]["elbow_angle"]
    m_rel = biomechanics["makes"]["release_angle"]
    x_rel = biomechanics["misses"]["release_angle"]
    m_knee = biomechanics["makes"]["knee_angle"]
    x_knee = biomechanics["misses"]["knee_angle"]

    if m_elbow and x_elbow and abs(m_elbow - x_elbow) >= 3.0:
        insights.append(
            f"Elbow Consistency: On made shots your elbow set angle averages {m_elbow}° (near the 90° pro ideal), compared to {x_elbow}° on misses."
        )
    if m_rel and x_rel and (m_rel - x_rel) >= 2.5:
        insights.append(
            f"Arc & Release Height: Your misses have a flatter release angle ({x_rel}° vs {m_rel}° on makes). Focus on finishing with your elbow above your eyebrow."
        )
    if m_knee and x_knee and (x_knee - m_knee) >= 4.0:
        insights.append(
            f"Lower-Body Power: On missed shots your knees are stiffer ({x_knee}° vs {m_knee}° on makes). Dip into a ~118° knee bend to transfer leg power into your arc."
        )
    if not insights:
        insights.append(
            "Keep logging shots with the live AI camera to unlock personalized Make vs. Miss biomechanical comparisons!"
        )

    return {
        "total_shots": total,
        "makes": makes,
        "misses": misses,
        "fg_pct": fg_pct,
        "biomechanics": biomechanics,
        "zones": zone_stats,
        "insights": insights,
        "recent_shots": shots[-30:],
    }


# Serve built React frontend in production (Option A unified container)
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.exists() and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
