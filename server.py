import os
import json
import time
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DATABASE_URL = os.getenv("DATABASE_URL")

def get_db_connection():
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL nije postavljen u environment varijablama!")
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

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
        # Utakmice
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS matches (
                id TEXT PRIMARY KEY,
                home_team TEXT NOT NULL,
                away_team TEXT NOT NULL,
                home_score INTEGER DEFAULT 0,
                away_score INTEGER DEFAULT 0,
                date TEXT NOT NULL,
                time TEXT,
                status TEXT DEFAULT 'scheduled'
            )
        """)
        # Timovi
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT,
                coach TEXT
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
        conn.commit()
    finally:
        conn.close()

# Inicijalizacija baze pri pokretanju
init_db()

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

@app.route('/api/announcements', methods=['GET', 'POST'])
def handle_announcements():
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

@app.route('/api/chat', methods=['GET', 'POST'])
def handle_chat():
    conn = get_db_connection()
    try:
        if request.method == 'POST':
            payload = request.get_json(silent=True) or {}
            msg_id = str(payload.get("id") or f"msg_{int(time.time()*1000)}")
            sender = str(payload.get("sender") or "Anonimno")
            text = str(payload.get("text") or "")
            ts = int(payload.get("ts") or time.time()*1000)

            if not text.strip():
                return jsonify({"ok": False, "error": "Poruka ne može biti prazna."}), 400

            db_execute(
                conn,
                "INSERT INTO chat_messages (id, sender, text, ts) VALUES (%s, %s, %s, %s)",
                (msg_id, sender, text, ts)
            )
            conn.commit()
            return jsonify({"ok": True})

        rows = db_fetchall(conn, "SELECT id, sender, text, ts FROM chat_messages ORDER BY ts ASC LIMIT 100")
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)