import os
import json
import time
import logging
import base64
import binascii
import uuid
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
SERVER_VERSION = "2026-10-19-gallery-chat"


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


def table_columns(conn, table):
    rows = db_fetchall(
        conn,
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = %s
        """,
        (table,)
    )
    return {r["column_name"]: r["data_type"] for r in rows}


def ensure_table(conn, name, create_sql, required):
    """Creates the table. If an OLD version with a different layout already exists
    (created by an earlier server.py), it is renamed to <name>_legacy (nothing is
    deleted) and a fresh table is created. Returns (legacy_name, legacy_columns)."""
    cols = table_columns(conn, name)
    legacy = None
    legacy_cols = {}
    if cols:
        missing = [c for c in required if c not in cols]
        bad_id = "id" in required and cols.get("id") not in ("text", "character varying")
        if missing or bad_id:
            legacy = f"{name}_legacy"
            if table_columns(conn, legacy):
                legacy = f"{name}_legacy_{int(time.time())}"
            legacy_cols = cols
            db_execute(conn, f"ALTER TABLE {name} RENAME TO {legacy}")
            conn.commit()
            log.warning("Tabela %s je imala staru strukturu -> preimenovana u %s", name, legacy)
    db_execute(conn, create_sql)
    conn.commit()
    return legacy, legacy_cols


def try_copy(conn, sql, label):
    """Best-effort copy of old data; a failure never stops the server."""
    try:
        db_execute(conn, sql)
        conn.commit()
        log.info("Preneseni stari podaci: %s", label)
    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        log.warning("Prenos starih podataka (%s) nije uspio: %s", label, exc)


def init_db():
    conn = get_db_connection()
    try:
        # Korisnici (postojeci racuni se cuvaju; samo se dodaju nedostajuce kolone)
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                profile_image TEXT
            )
        """)
        db_execute(conn, "ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'")
        db_execute(conn, "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT")
        conn.commit()
        user_cols = table_columns(conn, "users")
        if "avatar" in user_cols:
            try_copy(conn, "UPDATE users SET profile_image = avatar WHERE profile_image IS NULL AND avatar IS NOT NULL", "users.avatar")

        # Obavijesti
        legacy, lcols = ensure_table(conn, "announcements", """
            CREATE TABLE IF NOT EXISTS announcements (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                author TEXT,
                ts BIGINT NOT NULL
            )
        """, ["id", "title", "content", "author", "ts"])
        if legacy and "message" in lcols and "ts" in lcols:
            try_copy(conn, f"""
                INSERT INTO announcements (id, title, content, author, ts)
                SELECT 'legacy_' || id::text, '', COALESCE(message, ''), 'Admin', ts
                FROM {legacy} WHERE message IS NOT NULL
                ON CONFLICT (id) DO NOTHING
            """, "announcements")

        # Chat
        legacy, lcols = ensure_table(conn, "chat_messages", """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                sender TEXT NOT NULL,
                text TEXT NOT NULL DEFAULT '',
                image TEXT,
                ts BIGINT NOT NULL
            )
        """, ["id", "sender", "text", "ts"])
        db_execute(conn, "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image TEXT")
        conn.commit()
        if legacy and "username" in lcols and "message" in lcols and "ts" in lcols:
            image_expr = "image" if "image" in lcols else "NULL"
            try_copy(conn, f"""
                INSERT INTO chat_messages (id, sender, text, image, ts)
                SELECT 'legacy_' || id::text, username, COALESCE(message, ''), {image_expr}, ts
                FROM {legacy}
                ON CONFLICT (id) DO NOTHING
            """, "chat")

        # Galerija
        ensure_table(conn, "gallery", """
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
        """, ["id", "image", "description", "author", "ts", "likes", "dislikes", "comments"])
        db_execute(conn, "ALTER TABLE gallery ADD COLUMN IF NOT EXISTS reactions TEXT")
        conn.commit()

        # Utakmice (nove tabele; imena club_* ne smetaju starim 'matches' / 'teams')
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
                away_score INTEGER,
                details TEXT
            )
        """)
        # Postojece utakmice ostaju netaknute; samo se dodaje nova kolona
        db_execute(conn, "ALTER TABLE club_matches ADD COLUMN IF NOT EXISTS details TEXT")
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS club_teams (
                name TEXT PRIMARY KEY,
                badge TEXT
            )
        """)
        # Fotografije igraca (neobavezno; samo na stranici igraca)
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS club_players (
                name_key TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                photo TEXT,
                updated BIGINT NOT NULL DEFAULT 0
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
log.info("Server verzija: %s", SERVER_VERSION)
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


@app.errorhandler(Exception)
def handle_unexpected_error(exc):
    from werkzeug.exceptions import HTTPException
    if isinstance(exc, HTTPException):
        return jsonify({"ok": False, "error": exc.description}), exc.code
    log.exception("Neocekivana greska u %s %s", request.method, request.path)
    return jsonify({"ok": False, "error": f"Greška na serveru ({type(exc).__name__})."}), 500


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


def clean_text(value, limit=60):
    return str(value or "").strip()[:limit]


def clean_int(value, low=0, high=999):
    number = to_int_or_none(value)
    if number is None:
        return None
    return max(low, min(high, number))


def clean_details(raw):
    """Whitelists and limits the match-details object (scorers, timeouts, suspensions)."""
    if not isinstance(raw, dict):
        return None

    def as_list(value, limit=60):
        return value[:limit] if isinstance(value, list) else []

    out = {
        "venue": clean_text(raw.get("venue"), 80),
        "halfClub": clean_int(raw.get("halfClub")),
        "halfOpp": clean_int(raw.get("halfOpp")),
        "timeoutsClub": clean_int(raw.get("timeoutsClub"), 0, 3) or 0,
        "timeoutsOpp": clean_int(raw.get("timeoutsOpp"), 0, 3) or 0,
        "roster": [],
        "scorers": [],
        "suspensions": [],
    }
    for item in as_list(raw.get("roster"), 80):
        if not isinstance(item, dict):
            continue
        name = clean_text(item.get("name"))
        number = clean_text(item.get("number"), 4)
        if name or number:
            out["roster"].append({
                "side": "opp" if item.get("side") == "opp" else "club",
                "number": number, "name": name,
            })
    for item in as_list(raw.get("scorers")):
        if not isinstance(item, dict):
            continue
        name = clean_text(item.get("name"))
        number = clean_text(item.get("number"), 4)
        goals = clean_int(item.get("goals"), 0, 99) or 0
        if (name or number) and goals > 0:
            out["scorers"].append({
                "side": "opp" if item.get("side") == "opp" else "club",
                "number": number, "name": name, "goals": goals,
            })
    for item in as_list(raw.get("suspensions")):
        if not isinstance(item, dict):
            continue
        name = clean_text(item.get("name"))
        number = clean_text(item.get("number"), 4)
        if name or number:
            out["suspensions"].append({
                "side": "opp" if item.get("side") == "opp" else "club",
                "number": number, "name": name,
                "count": clean_int(item.get("count"), 0, 9) or 0,
                "red": bool(item.get("red")),
            })
    return out


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
    details = clean_details(item.get("details")) if "details" in item else None
    details_json = json.dumps(details, ensure_ascii=False) if details is not None else None
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
        details_json,
    )


UPSERT_MATCH_SQL = """
    INSERT INTO club_matches
        (id, opponent, datetime, location, competition, generation, played, home_score, away_score, details)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (id) DO UPDATE SET
        opponent = EXCLUDED.opponent,
        datetime = EXCLUDED.datetime,
        location = EXCLUDED.location,
        competition = EXCLUDED.competition,
        generation = EXCLUDED.generation,
        played = EXCLUDED.played,
        home_score = EXCLUDED.home_score,
        away_score = EXCLUDED.away_score,
        details = COALESCE(EXCLUDED.details, club_matches.details)
"""


def load_json(raw, default):
    try:
        value = json.loads(raw) if raw else default
    except (TypeError, ValueError):
        return default
    return value if isinstance(value, type(default)) else default


def normalize_comments(raw):
    out = []
    for i, c in enumerate(load_json(raw, [])):
        if not isinstance(c, dict):
            continue
        out.append({
            "id": str(c.get("id") or f"legacy_{i}"),
            "user": str(c.get("user") or "Korisnik"),
            "text": str(c.get("text") or ""),
            "ts": to_int_or_none(c.get("ts")) or 0,
        })
    return out


def reaction_summary(raw, user):
    reactions = load_json(raw, {})
    likes = sum(1 for v in reactions.values() if v == "like")
    dislikes = sum(1 for v in reactions.values() if v == "dislike")
    mine = reactions.get(user.lower(), "") if user else ""
    return likes, dislikes, mine


def user_exists(conn, username):
    if not username:
        return False
    row = db_fetchone(conn, "SELECT username FROM users WHERE LOWER(username) = LOWER(%s)", (username,))
    return bool(row)


def image_response(data_url):
    try:
        header, b64 = data_url.split(",", 1)
        mimetype = header[5:].split(";")[0] or "image/jpeg"
        data = base64.b64decode(b64)
    except (ValueError, binascii.Error):
        return jsonify({"ok": False, "error": "Bad image"}), 500
    resp = Response(data, mimetype=mimetype)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


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
            chat_columns = sorted(table_columns(conn, "chat_messages").keys())
        finally:
            conn.close()
        return jsonify({"ok": True, "db": "up", "version": SERVER_VERSION, "chat_columns": chat_columns})
    except Exception as exc:  # noqa: BLE001
        log.error("Health check: baza nedostupna: %s", exc)
        return jsonify({"ok": False, "db": "down", "version": SERVER_VERSION, "error": type(exc).__name__}), 503


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

@app.route('/api/gallery', methods=['GET'])
def get_gallery():
    """Metadata only: images are loaded separately (and cached) via /api/gallery/<id>/image."""
    user = request_user()
    conn = get_db_connection()
    try:
        rows = db_fetchall(
            conn,
            """
            SELECT id, description, author, ts, reactions, comments,
                   (image IS NOT NULL AND image <> '') AS has_image
            FROM gallery
            ORDER BY ts DESC
            """
        )
        result = []
        for r in rows:
            likes, dislikes, mine = reaction_summary(r["reactions"], user)
            result.append({
                "id": r["id"],
                "description": r["description"] or "",
                "author": r["author"] or "Admin",
                "ts": r["ts"],
                "hasImage": bool(r["has_image"]),
                "likes": likes,
                "dislikes": dislikes,
                "myReaction": mine,
                "comments": normalize_comments(r["comments"]),
            })
        return jsonify(result)
    finally:
        conn.close()


@app.route('/api/gallery', methods=['POST'])
def create_gallery_item():
    denied = admin_required()
    if denied:
        return denied
    payload = request.get_json(silent=True) or {}
    item_id = str(payload.get("id") or f"gal_{int(time.time()*1000)}")[:64]
    image = str(payload.get("image") or "")
    description = str(payload.get("description") or "").strip()[:500]
    author = str(payload.get("author") or "Admin")[:60]
    ts = to_int_or_none(payload.get("ts")) or int(time.time() * 1000)

    if not image.startswith("data:image/") or len(image) > 3_500_000:
        return jsonify({"ok": False, "error": "Invalid or too large image."}), 400

    conn = get_db_connection()
    try:
        db_execute(
            conn,
            """
            INSERT INTO gallery (id, image, description, author, ts, likes, dislikes, comments, reactions)
            VALUES (%s, %s, %s, %s, %s, 0, 0, '[]', '{}')
            ON CONFLICT (id) DO UPDATE SET description = EXCLUDED.description
            """,
            (item_id, image, description, author, ts)
        )
        conn.commit()
        return jsonify({"ok": True, "id": item_id})
    finally:
        conn.close()


@app.route('/api/gallery/<item_id>', methods=['DELETE'])
def delete_gallery_item(item_id):
    denied = admin_required()
    if denied:
        return denied
    conn = get_db_connection()
    try:
        db_execute(conn, "DELETE FROM gallery WHERE id = %s", (item_id,))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/gallery/<item_id>/image', methods=['GET'])
def gallery_image(item_id):
    conn = get_db_connection()
    try:
        row = db_fetchone(conn, "SELECT image FROM gallery WHERE id = %s", (item_id,))
    finally:
        conn.close()
    if not row or not row["image"]:
        return jsonify({"ok": False, "error": "Not found"}), 404
    return image_response(row["image"])


@app.route('/api/gallery/<item_id>/react', methods=['POST'])
def react_gallery_item(item_id):
    """One reaction per user per image. value: 'like', 'dislike' or '' (remove)."""
    user = request_user()
    value = str((request.get_json(silent=True) or {}).get("value") or "")
    conn = get_db_connection()
    try:
        if not user_exists(conn, user):
            return jsonify({"ok": False, "error": "Prijavite se da biste reagovali."}), 403
        row = db_fetchone(conn, "SELECT reactions FROM gallery WHERE id = %s FOR UPDATE", (item_id,))
        if not row:
            return jsonify({"ok": False, "error": "Slika nije pronađena."}), 404
        reactions = load_json(row["reactions"], {})
        if value in ("like", "dislike"):
            reactions[user.lower()] = value
        else:
            reactions.pop(user.lower(), None)
        raw = json.dumps(reactions, ensure_ascii=False)
        db_execute(conn, "UPDATE gallery SET reactions = %s WHERE id = %s", (raw, item_id))
        conn.commit()
        likes, dislikes, mine = reaction_summary(raw, user)
        return jsonify({"ok": True, "likes": likes, "dislikes": dislikes, "myReaction": mine})
    finally:
        conn.close()


@app.route('/api/gallery/<item_id>/comments', methods=['POST'])
def add_gallery_comment(item_id):
    user = request_user()
    text = str((request.get_json(silent=True) or {}).get("text") or "").strip()[:300]
    if not text:
        return jsonify({"ok": False, "error": "Komentar ne može biti prazan."}), 400
    conn = get_db_connection()
    try:
        if not user_exists(conn, user):
            return jsonify({"ok": False, "error": "Prijavite se da biste komentarisali."}), 403
        row = db_fetchone(conn, "SELECT comments FROM gallery WHERE id = %s FOR UPDATE", (item_id,))
        if not row:
            return jsonify({"ok": False, "error": "Slika nije pronađena."}), 404
        comments = normalize_comments(row["comments"])
        if len(comments) >= 500:
            return jsonify({"ok": False, "error": "Previše komentara."}), 400
        comment = {
            "id": f"c_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}",
            "user": user,
            "text": text,
            "ts": int(time.time() * 1000),
        }
        comments.append(comment)
        db_execute(conn, "UPDATE gallery SET comments = %s WHERE id = %s",
                   (json.dumps(comments, ensure_ascii=False), item_id))
        conn.commit()
        return jsonify({"ok": True, "comment": comment})
    finally:
        conn.close()


@app.route('/api/gallery/<item_id>/comments/<comment_id>', methods=['DELETE'])
def delete_gallery_comment(item_id, comment_id):
    user = request_user()
    conn = get_db_connection()
    try:
        row = db_fetchone(conn, "SELECT comments FROM gallery WHERE id = %s FOR UPDATE", (item_id,))
        if not row:
            return jsonify({"ok": False, "error": "Slika nije pronađena."}), 404
        comments = normalize_comments(row["comments"])
        target = next((c for c in comments if c["id"] == comment_id), None)
        if not target:
            return jsonify({"ok": True})
        if not (is_admin_request() or (user and target["user"].lower() == user.lower())):
            return jsonify({"ok": False, "error": "Not allowed"}), 403
        comments = [c for c in comments if c["id"] != comment_id]
        db_execute(conn, "UPDATE gallery SET comments = %s WHERE id = %s",
                   (json.dumps(comments, ensure_ascii=False), item_id))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/chat', methods=['GET', 'POST'])
def handle_chat():
    conn = get_db_connection()
    try:
        if request.method == 'POST':
            payload = request.get_json(silent=True) or {}
            msg_id = str(payload.get("id") or f"msg_{int(time.time()*1000)}")[:64]
            sender = (request_user() or str(payload.get("sender") or "Anonimno")).strip()[:60]
            text = str(payload.get("text") or "").strip()[:1000]
            image = str(payload.get("image") or "")
            if image and (not image.startswith("data:image/") or len(image) > 3_500_000):
                image = ""
            if not text and not image:
                return jsonify({"ok": False, "error": "Poruka ne može biti prazna."}), 400

            # Vrijeme postavlja server (satovi korisnika se razlikuju). Ponovni pokusaj ne pravi duplikat.
            now = int(time.time() * 1000)
            db_execute(
                conn,
                """
                INSERT INTO chat_messages (id, sender, text, image, ts)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (msg_id, sender, text, image or None, now)
            )
            row = db_fetchone(conn, "SELECT ts FROM chat_messages WHERE id = %s", (msg_id,))
            conn.commit()
            return jsonify({"ok": True, "id": msg_id, "ts": row["ts"] if row else now})

        since = to_int_or_none(request.args.get("since"))
        if since is not None:
            # samo novije poruke (brzo osvjezavanje)
            rows = db_fetchall(
                conn,
                """
                SELECT id, sender, text, ts, (image IS NOT NULL AND image <> '') AS has_image
                FROM chat_messages
                WHERE ts >= %s
                ORDER BY ts ASC, id ASC
                LIMIT 200
                """,
                (since,)
            )
        else:
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
                ORDER BY ts ASC, id ASC
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
                   played, home_score, away_score, details
            FROM club_matches
            ORDER BY datetime ASC
            """
        )

        def parse_details(raw):
            try:
                return json.loads(raw) if raw else {}
            except (TypeError, ValueError):
                return {}

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
                "details": parse_details(r["details"]),
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


# ---------------------------------------------------------------------------
# Player photos (optional, admin only to change)
# ---------------------------------------------------------------------------

def player_key(name):
    return " ".join(str(name or "").split()).lower()


@app.route('/api/players', methods=['GET'])
def list_players():
    """Only metadata (no photo data) so the list stays small and fast."""
    conn = get_db_connection()
    try:
        rows = db_fetchall(
            conn,
            "SELECT name_key, name, (photo IS NOT NULL AND photo <> '') AS has_photo, updated FROM club_players"
        )
        return jsonify({
            r["name_key"]: {"name": r["name"], "hasPhoto": bool(r["has_photo"]), "updated": r["updated"]}
            for r in rows
        })
    finally:
        conn.close()


@app.route('/api/players/photo', methods=['GET'])
def get_player_photo():
    key = player_key(request.args.get("name"))
    conn = get_db_connection()
    try:
        row = db_fetchone(conn, "SELECT photo FROM club_players WHERE name_key = %s", (key,))
    finally:
        conn.close()
    if not row or not row["photo"]:
        return jsonify({"ok": False, "error": "Not found"}), 404
    try:
        header, b64 = row["photo"].split(",", 1)
        mimetype = header[5:].split(";")[0] or "image/jpeg"
        data = base64.b64decode(b64)
    except (ValueError, binascii.Error):
        return jsonify({"ok": False, "error": "Bad image"}), 500
    resp = Response(data, mimetype=mimetype)
    resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return resp


@app.route('/api/players/photo', methods=['POST'])
def set_player_photo():
    denied = admin_required()
    if denied:
        return denied
    data = request.get_json(silent=True) or {}
    name = clean_text(" ".join(str(data.get("name") or "").split()), 80)
    photo = str(data.get("photo") or "")
    if not name:
        return jsonify({"ok": False, "error": "Player name is required."}), 400
    if not photo.startswith("data:image/"):
        return jsonify({"ok": False, "error": "Invalid image."}), 400
    if len(photo) > 2_500_000:
        return jsonify({"ok": False, "error": "Image is too large."}), 400

    conn = get_db_connection()
    try:
        db_execute(
            conn,
            """
            INSERT INTO club_players (name_key, name, photo, updated)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (name_key) DO UPDATE SET
                name = EXCLUDED.name,
                photo = EXCLUDED.photo,
                updated = EXCLUDED.updated
            """,
            (player_key(name), name, photo, int(time.time() * 1000))
        )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/players/photo', methods=['DELETE'])
def delete_player_photo():
    denied = admin_required()
    if denied:
        return denied
    key = player_key(request.args.get("name"))
    conn = get_db_connection()
    try:
        db_execute(
            conn,
            "UPDATE club_players SET photo = NULL, updated = %s WHERE name_key = %s",
            (int(time.time() * 1000), key)
        )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
