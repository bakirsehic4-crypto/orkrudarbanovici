import os
import json
import time
import logging
import base64
import binascii
from urllib.parse import unquote
import psycopg
from psycopg.rows import dict_row
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("server")

DATABASE_URL = os.getenv("DATABASE_URL")
ADMIN_USERNAME = "admin"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db_connection():
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL nije postavljen u environment varijablama!")
    # prepare_threshold=None -> works with Supabase pooler (pgbouncer) too
    return psycopg.connect(
        DATABASE_URL,
        row_factory=dict_row,
        prepare_threshold=None,
        connect_timeout=10,
    )


def db_execute(conn, query, params=None):
    with conn.cursor() as cur:
        cur.execute(query, params or ())


def db_fetchall(conn, query, params=None):
    with conn.cursor() as cur:
        cur.execute(query, params or ())
        return cur.fetchall()


def db_fetchone(conn, query, params=None):
    with conn.cursor() as cur:
        cur.execute(query, params or ())
        return cur.fetchone()


def init_db():
    conn = get_db_connection()
    try:
        # Korisnici
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                profile_image TEXT
            )
        """)
        # Obavještenja
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS announcements (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                author TEXT,
                ts BIGINT NOT NULL
            )
        """)
        # Poruke (Chat)
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                ts BIGINT NOT NULL
            )
        """)
        db_execute(conn, "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image TEXT")
        # Galerija
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS gallery (
                id TEXT PRIMARY KEY,
                image TEXT NOT NULL,
                description TEXT,
                author TEXT,
                ts BIGINT NOT NULL,
                likes INTEGER DEFAULT 0,
                dislikes INTEGER DEFAULT 0,
                comments TEXT
            )
        """)
        # Utakmice (nove tabele, oblik odgovara matches.html)
        # Imena club_* su namjerno nova da se ne sukobe sa starim
        # 'matches' / 'teams' tabelama koje mogu vec postojati u bazi.
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS club_matches (
                id TEXT PRIMARY KEY,
                opponent TEXT NOT NULL,
                datetime TEXT NOT NULL,
                location TEXT NOT NULL DEFAULT 'home',
                competition TEXT,
                generation TEXT,
                played BOOLEAN NOT NULL DEFAULT FALSE,
                home_score INTEGER,
                away_score INTEGER
            )
        """)
        # Timovi i grbovi
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS club_teams (
                name TEXT PRIMARY KEY,
                badge TEXT
            )
        """)
        conn.commit()
    finally:
        conn.close()


# Baza se priprema pri prvom zahtjevu (ne pri importu), pa aplikacija
# ne pada pri pokretanju ako je baza trenutno nedostupna.
_db_ready = False


def ensure_db():
    global _db_ready
    if not _db_ready:
        init_db()
        _db_ready = True


# Pokusaj odmah pri pokretanju, ali bez rušenja servera ako ne uspije
try:
    ensure_db()
    log.info("Baza spremna.")
except Exception as exc:  # noqa: BLE001
    log.error("Inicijalizacija baze nije uspjela (pokusat cu ponovo): %s", exc)


@app.before_request
def before_request():
    if request.method == "OPTIONS":
        return None
    if request.path in ("/", "/api/health"):
        return None
    try:
        ensure_db()
    except Exception as exc:  # noqa: BLE001
        log.error("Baza nedostupna: %s", exc)
        return jsonify({"ok": False, "error": "Baza podataka trenutno nije dostupna."}), 503
    return None


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def is_admin_request():
    return unquote(request.headers.get("X-Club-User", "")).strip().lower() == ADMIN_USERNAME


def request_user():
    return unquote(request.headers.get("X-Club-User", "")).strip()


def admin_required():
    """Returns an error response if the caller is not admin, otherwise None."""
    if not is_admin_request():
        return jsonify({"ok": False, "error": "Admin access required"}), 403
    return None


def to_int_or_none(value):
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def normalize_match(item):
    """Turns a match dict from the frontend into a DB row tuple (or None if invalid)."""
    if not isinstance(item, dict):
        return None
    opponent = str(item.get("opponent") or "").strip()
    dt = str(item.get("datetime") or "").strip()
    if not opponent or not dt:
        return None
    match_id = str(item.get("id") or f"m_{int(time.time() * 1000)}")
    location = "away" if item.get("location") == "away" else "home"
    competition = str(item.get("competition") or "").strip() or None
    generation = str(item.get("generation") or "").strip() or None
    return (
        match_id,
        opponent,
        dt,
        location,
        competition,
        generation,
        bool(item.get("played")),
        to_int_or_none(item.get("homeScore")),
        to_int_or_none(item.get("awayScore")),
    )


UPSERT_MATCH_SQL = """
    INSERT INTO club_matches
        (id, opponent, datetime, location, competition, generation, played, home_score, away_score)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (id) DO UPDATE SET
        opponent = EXCLUDED.opponent,
        datetime = EXCLUDED.datetime,
        location = EXCLUDED.location,
        competition = EXCLUDED.competition,
        generation = EXCLUDED.generation,
        played = EXCLUDED.played,
        home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score
"""


# ---------------------------------------------------------------------------
# Basic / health routes
# ---------------------------------------------------------------------------

@app.route('/', methods=['GET'])
def index():
    return jsonify({"ok": True, "message": "API ready"})


@app.route('/api/health', methods=['GET'])
def health():
    try:
        conn = get_db_connection()
        try:
            db_fetchone(conn, "SELECT 1 AS ok")
        finally:
            conn.close()
        return jsonify({"ok": True, "db": "up"})
    except Exception as exc:  # noqa: BLE001
        log.error("Health check: baza nedostupna: %s", exc)
        return jsonify({"ok": False, "db": "down", "error": type(exc).__name__}), 503


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()

    if not username or not password:
        return jsonify({"ok": False, "error": "Unesite korisničko ime i lozinku."}), 400

    conn = get_db_connection()
    try:
        user = db_fetchone(conn, "SELECT * FROM users WHERE LOWER(username) = LOWER(%s)", (username,))
        if user and user["password"] == password:
            return jsonify({
                "ok": True,
                "user": {
                    "username": user["username"],
                    "role": user["role"],
                    "profileImage": user["profile_image"] or ""
                }
            })
        return jsonify({"ok": False, "error": "Neispravno korisničko ime ili lozinka."}), 401
    finally:
        conn.close()


@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json(silent=True) or {}
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", "")).strip()
    profile_image = str(data.get("profileImage", "")).strip()

    if not username or not password:
        return jsonify({"ok": False, "error": "Korisničko ime i lozinka su obavezni."}), 400

    conn = get_db_connection()
    try:
        existing = db_fetchone(conn, "SELECT username FROM users WHERE LOWER(username) = LOWER(%s)", (username,))
        if existing:
            return jsonify({"ok": False, "error": "Korisničko ime je već zauzeto."}), 400

        db_execute(
            conn,
            "INSERT INTO users (username, password, role, profile_image) VALUES (%s, %s, %s, %s)",
            (username, password, 'user', profile_image)
        )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Announcements
# ---------------------------------------------------------------------------

@app.route('/api/announcements', methods=['GET', 'POST'])
def handle_announcements():
    if request.method == 'POST':
        denied = admin_required()
        if denied:
            return denied
    conn = get_db_connection()
    try:
        if request.method == 'POST':
            payload = request.get_json(silent=True) or {}
            item_id = str(payload.get("id") or f"ann_{int(time.time()*1000)}")
            title = str(payload.get("title") or "")
            content = str(payload.get("content") or "")
            author = str(payload.get("author") or "Admin")
            ts = int(payload.get("ts") or time.time()*1000)

            db_execute(
                conn,
                """
                INSERT INTO announcements (id, title, content, author, ts)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    content = EXCLUDED.content
                """,
                (item_id, title, content, author, ts)
            )
            conn.commit()
            return jsonify({"ok": True})

        rows = db_fetchall(conn, "SELECT id, title, content, author, ts FROM announcements ORDER BY ts DESC")
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@app.route('/api/announcements/<item_id>', methods=['DELETE'])
def delete_announcement(item_id):
    denied = admin_required()
    if denied:
        return denied
    conn = get_db_connection()
    try:
        db_execute(conn, "DELETE FROM announcements WHERE id = %s", (item_id,))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Gallery
# ---------------------------------------------------------------------------

@app.route('/api/gallery', methods=['GET', 'POST'])
def handle_gallery():
    conn = get_db_connection()
    try:
        if request.method == 'POST':
            payload = request.get_json(silent=True) or {}
            item_id = str(payload.get("id") or f"gal_{int(time.time()*1000)}")
            image = str(payload.get("image") or "")
            description = str(payload.get("description") or "")
            author = str(payload.get("author") or "Admin")
            ts = int(payload.get("ts") or time.time()*1000)
            likes = int(payload.get("likes") or 0)
            dislikes = int(payload.get("dislikes") or 0)
            comments = json.dumps(payload.get("comments") or [])

            exists = db_fetchone(conn, "SELECT id FROM gallery WHERE id = %s", (item_id,))
            if not exists and not is_admin_request():
                return jsonify({"ok": False, "error": "Admin access required"}), 403

            db_execute(
                conn,
                """
                INSERT INTO gallery (id, image, description, author, ts, likes, dislikes, comments)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    likes = EXCLUDED.likes,
                    dislikes = EXCLUDED.dislikes,
                    comments = EXCLUDED.comments
                """,
                (item_id, image, description, author, ts, likes, dislikes, comments)
            )
            conn.commit()
            return jsonify({"ok": True})

        rows = db_fetchall(conn, "SELECT id, image, description, author, ts, likes, dislikes, comments FROM gallery ORDER BY ts DESC")
        result = []
        for r in rows:
            result.append({
                "id": r["id"],
                "image": r["image"],
                "description": r["description"],
                "author": r["author"],
                "ts": r["ts"],
                "likes": r["likes"],
                "dislikes": r["dislikes"],
                "comments": json.loads(r["comments"]) if r["comments"] else []
            })
        return jsonify(result)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@app.route('/api/chat', methods=['GET', 'POST'])
def handle_chat():
    conn = get_db_connection()
    try:
        if request.method == 'POST':
            payload = request.get_json(silent=True) or {}
            msg_id = str(payload.get("id") or f"msg_{int(time.time()*1000)}")
            sender = str(payload.get("sender") or "Anonimno")
            text = str(payload.get("text") or "").strip()
            image = str(payload.get("image") or "")
            ts = int(payload.get("ts") or time.time()*1000)

            if image and not image.startswith("data:image/"):
                image = ""
            if not text and not image:
                return jsonify({"ok": False, "error": "Poruka ne može biti prazna."}), 400

            db_execute(
                conn,
                "INSERT INTO chat_messages (id, sender, text, image, ts) VALUES (%s, %s, %s, %s, %s)",
                (msg_id, sender, text, image or None, ts)
            )
            conn.commit()
            return jsonify({"ok": True})

        # zadnjih 100 poruka, od starijih prema novijim (slike se ne šalju ovdje)
        rows = db_fetchall(
            conn,
            """
            SELECT id, sender, text, ts, (image IS NOT NULL AND image <> '') AS has_image
            FROM (
                SELECT id, sender, text, image, ts
                FROM chat_messages
                ORDER BY ts DESC
                LIMIT 100
            ) latest
            ORDER BY ts ASC
            """
        )
        return jsonify([
            {
                "id": r["id"],
                "sender": r["sender"],
                "text": r["text"],
                "ts": r["ts"],
                "hasImage": bool(r["has_image"]),
            }
            for r in rows
        ])
    finally:
        conn.close()


@app.route('/api/chat/<msg_id>/image', methods=['GET'])
def chat_image(msg_id):
    """Serves a chat image as a real image file so the browser can cache it."""
    conn = get_db_connection()
    try:
        row = db_fetchone(conn, "SELECT image FROM chat_messages WHERE id = %s", (msg_id,))
    finally:
        conn.close()
    if not row or not row["image"]:
        return jsonify({"ok": False, "error": "Not found"}), 404
    try:
        header, b64 = row["image"].split(",", 1)
        mimetype = header[5:].split(";")[0] or "image/jpeg"
        data = base64.b64decode(b64)
    except (ValueError, binascii.Error):
        return jsonify({"ok": False, "error": "Bad image"}), 500
    resp = Response(data, mimetype=mimetype)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


# ---------------------------------------------------------------------------
# Matches (restored) - used by matches.html
# ---------------------------------------------------------------------------

@app.route('/api/matches', methods=['GET'])
def get_matches():
    conn = get_db_connection()
    try:
        rows = db_fetchall(
            conn,
            """
            SELECT id, opponent, datetime, location, competition, generation,
                   played, home_score, away_score
            FROM club_matches
            ORDER BY datetime ASC
            """
        )
        return jsonify([
            {
                "id": r["id"],
                "opponent": r["opponent"],
                "datetime": r["datetime"],
                "location": r["location"],
                "competition": r["competition"] or "",
                "generation": r["generation"] or "",
                "played": bool(r["played"]),
                "homeScore": r["home_score"],
                "awayScore": r["away_score"],
            }
            for r in rows
        ])
    finally:
        conn.close()


@app.route('/api/matches', methods=['POST'])
def save_matches():
    """Admin only. Accepts one match (dict) or several (list) and upserts them.
    Nothing is ever deleted here - use DELETE /api/matches/<id> for that."""
    denied = admin_required()
    if denied:
        return denied

    payload = request.get_json(silent=True)
    items = payload if isinstance(payload, list) else [payload]

    rows = [normalize_match(item) for item in items]
    if not rows or any(r is None for r in rows):
        return jsonify({"ok": False, "error": "Each match needs an opponent and a date/time."}), 400

    conn = get_db_connection()
    try:
        for row in rows:
            db_execute(conn, UPSERT_MATCH_SQL, row)
        conn.commit()
        return jsonify({"ok": True, "saved": len(rows)})
    finally:
        conn.close()


@app.route('/api/matches/<match_id>', methods=['DELETE'])
def delete_match(match_id):
    denied = admin_required()
    if denied:
        return denied
    conn = get_db_connection()
    try:
        db_execute(conn, "DELETE FROM club_matches WHERE id = %s", (match_id,))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Teams / badges (restored) - used by matches.html
# ---------------------------------------------------------------------------

@app.route('/api/teams', methods=['GET'])
def get_teams():
    conn = get_db_connection()
    try:
        rows = db_fetchall(conn, "SELECT name, badge FROM club_teams ORDER BY name ASC")
        return jsonify({r["name"]: r["badge"] for r in rows})
    finally:
        conn.close()


@app.route('/api/teams', methods=['POST'])
def save_teams():
    """Admin only. Body: {"Team name": "<badge data URL>", ...}. Upserts only the given teams."""
    denied = admin_required()
    if denied:
        return denied

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "Expected an object of {teamName: badge}."}), 400

    conn = get_db_connection()
    try:
        saved = 0
        for name, badge in payload.items():
            name = str(name).strip()
            if not name:
                continue
            db_execute(
                conn,
                """
                INSERT INTO club_teams (name, badge) VALUES (%s, %s)
                ON CONFLICT (name) DO UPDATE SET badge = EXCLUDED.badge
                """,
                (name, str(badge) if badge else None)
            )
            saved += 1
        conn.commit()
        return jsonify({"ok": True, "saved": saved})
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Users (avatars)
# ---------------------------------------------------------------------------

@app.route('/api/users/<username>', methods=['GET'])
def get_user(username):
    conn = get_db_connection()
    try:
        row = db_fetchone(
            conn,
            "SELECT username, profile_image FROM users WHERE LOWER(username) = LOWER(%s)",
            (username,)
        )
        if not row:
            return jsonify({"ok": False, "error": "User not found"}), 404
        return jsonify({"ok": True, "username": row["username"], "avatar": row["profile_image"] or ""})
    finally:
        conn.close()


@app.route('/api/users/<username>/avatar', methods=['PUT'])
def update_avatar(username):
    # Svako smije mijenjati samo svoju sliku
    if request_user().lower() != username.strip().lower():
        return jsonify({"ok": False, "error": "Not allowed"}), 403
    data = request.get_json(silent=True) or {}
    avatar = str(data.get("avatar") or "").strip()
    if avatar and not avatar.startswith("data:image/"):
        return jsonify({"ok": False, "error": "Invalid image"}), 400

    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE users SET profile_image = %s WHERE LOWER(username) = LOWER(%s)",
                (avatar or None, username)
            )
            updated = cur.rowcount
        conn.commit()
        if updated == 0:
            return jsonify({"ok": False, "error": "User not found"}), 404
        return jsonify({"ok": True})
    finally:
        conn.close()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
