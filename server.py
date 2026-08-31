#!/usr/bin/env python3
import json
import os
import sqlite3
import uuid
from typing import Any

from flask import Flask, jsonify, request

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:
    psycopg = None

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "database.db")

app = Flask(__name__)
ADMIN_USERNAME = "admin"


def get_database_url():
    return os.environ.get("DATABASE_URL")


def is_postgres() -> bool:
    return bool(get_database_url()) and psycopg is not None


def require_postgres():
    db_url = get_database_url()
    if not db_url:
        raise RuntimeError("DATABASE_URL is not set. Configure Postgres in Render environment variables.")
    if psycopg is None:
        raise RuntimeError("psycopg is not installed.")
    return db_url


def require_admin():
    if request.headers.get("X-Club-User") != ADMIN_USERNAME:
        return jsonify({"ok": False, "error": "Admin access required"}), 403
    return None


@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Club-User'
    response.headers['Access-Control-Max-Age'] = '86400'
    return response


@app.route('/', defaults={'path': ''}, methods=['OPTIONS'])
@app.route('/<path:path>', methods=['OPTIONS'])
def options_handler(path):
    return '', 200


@app.route('/', methods=['GET'])
def index():
    if not is_postgres():
        return jsonify({
            "ok": False,
            "message": "DATABASE_URL is missing or Postgres is unavailable.",
            "db": "sqlite"
        }), 500
    return jsonify({"ok": True, "message": "API ready", "db": "postgres"})


def get_db_connection():
    if not is_postgres():
        raise RuntimeError("Postgres is required. Set DATABASE_URL and keep psycopg installed.")
    conn = psycopg.connect(require_postgres(), sslmode="require")
    conn.autocommit = False
    return conn


def db_execute(conn, query, params=()):
    if is_postgres():
        cur = conn.cursor()
        cur.execute(query, params)
        return cur
    return conn.execute(query, params)


def db_fetchall(conn, query, params=()):
    if is_postgres():
        cur = conn.cursor(row_factory=dict_row)
        cur.execute(query, params)
        rows = cur.fetchall()
        cur.close()
        return rows
    return conn.execute(query, params).fetchall()


def db_fetchone(conn, query, params=()):
    if is_postgres():
        cur = conn.cursor(row_factory=dict_row)
        cur.execute(query, params)
        row = cur.fetchone()
        cur.close()
        return row
    return conn.execute(query, params).fetchone()


def init_db():
    conn = get_db_connection()
    try:
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS announcements (
                id SERIAL PRIMARY KEY,
                message TEXT,
                ts BIGINT NOT NULL
            )
        """)
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL,
                message TEXT NOT NULL,
                image TEXT,
                ts BIGINT NOT NULL
            )
        """)
        db_execute(conn, "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image TEXT")
        db_execute(conn, "ALTER TABLE chat_messages ALTER COLUMN message DROP NOT NULL")
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS matches (
                id TEXT PRIMARY KEY,
                opponent TEXT NOT NULL,
                datetime TEXT NOT NULL,
                location TEXT NOT NULL,
                competition TEXT,
                generation TEXT,
                played INTEGER NOT NULL DEFAULT 0,
                home_score INTEGER,
                away_score INTEGER
            )
        """)
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS teams (
                name TEXT PRIMARY KEY,
                badge TEXT
            )
        """)
        db_execute(conn, """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL,
                avatar TEXT
            )
        """)
        conn.commit()
    finally:
        conn.close()


@app.route('/debug-db', methods=['GET'])
def debug_db():
    return jsonify({
        "DATABASE_URL_set": bool(os.environ.get("DATABASE_URL")),
        "psycopg_importable": psycopg is not None,
        "db": "postgres" if is_postgres() else "sqlite",
        "message": "debug metadata"
    })


@app.route('/api/health', methods=['GET'])
def health():
    if not is_postgres():
        return jsonify({"ok": False, "db": "sqlite", "message": "DATABASE_URL missing"}), 500
    return jsonify({"ok": True, "db": "postgres", "message": "API ready"})


@app.route('/api/announcements', methods=['GET'])
def get_announcements():
    conn = get_db_connection()
    try:
        rows = db_fetchall(conn, "SELECT message, ts FROM announcements ORDER BY ts DESC")
        data = [{"message": row["message"], "ts": row["ts"], "author": "Trener"} for row in rows]
        return jsonify(data)
    finally:
        conn.close()


@app.route('/api/announcements', methods=['POST'])
def save_announcements():
    payload = request.get_json(silent=True)
    conn = get_db_connection()
    try:
        if isinstance(payload, list):
            db_execute(conn, "DELETE FROM announcements")
            for item in payload:
                db_execute(
                    conn,
                    "INSERT INTO announcements (message, ts) VALUES (%s, %s)",
                    (item.get("message", ""), int(item.get("ts", 0))),
                )
            conn.commit()
            return jsonify({"ok": True, "data": payload})

        if isinstance(payload, dict):
            db_execute(
                conn,
                "INSERT INTO announcements (message, ts) VALUES (%s, %s)",
                (payload.get("message", ""), int(payload.get("ts", 0))),
            )
            conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/chat', methods=['GET'])
def get_chat_messages():
    conn = get_db_connection()
    try:
        rows = db_fetchall(conn, """
            SELECT chat_messages.username, chat_messages.message, chat_messages.image, chat_messages.ts, users.avatar
            FROM chat_messages
            LEFT JOIN users ON users.username = chat_messages.username
            ORDER BY chat_messages.ts ASC
        """)
        return jsonify([{"username": row["username"], "message": row["message"], "image": row["image"], "ts": row["ts"], "avatar": row["avatar"]} for row in rows])
    finally:
        conn.close()


@app.route('/api/chat', methods=['POST'])
def save_chat_message():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username") or "").strip()
    message = str(payload.get("message") or "").strip()
    image = str(payload.get("image") or "").strip() or None
    if not username or (not message and not image):
        return jsonify({"ok": False, "error": "Korisničko ime ili slika su obavezni"}), 400

    conn = get_db_connection()
    try:
        db_execute(
            conn,
            "INSERT INTO chat_messages (username, message, image, ts) VALUES (%s, %s, %s, %s)",
            (username, message, image, int(payload.get("ts") or 0)),
        )
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/matches', methods=['GET', 'POST'])
def handle_matches():
    conn = get_db_connection()
    try:
        if request.method == 'POST':
            payload = request.get_json(silent=True) or {}
            match_id = str(payload.get("id") or str(uuid.uuid4()))
            opponent = str(payload.get("opponent") or "").strip()
            datetime_val = str(payload.get("datetime") or "").strip()
            location = str(payload.get("location") or "").strip()
            competition = payload.get("competition")
            generation = payload.get("generation")
            played = 1 if payload.get("played") else 0
            home_score = payload.get("homeScore") if payload.get("homeScore") is not None else payload.get("home_score")
            away_score = payload.get("awayScore") if payload.get("awayScore") is not None else payload.get("away_score")

            db_execute(
                conn,
                """
                INSERT INTO matches (id, opponent, datetime, location, competition, generation, played, home_score, away_score)
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
                """,
                (match_id, opponent, datetime_val, location, competition, generation, played, home_score, away_score)
            )
            conn.commit()
            return jsonify({"ok": True, "message": "Match saved successfully"}), 201

        rows = db_fetchall(
            conn,
            """
            SELECT id, opponent, datetime, location, competition, generation,
                   played, home_score, away_score
            FROM matches
            ORDER BY datetime ASC
            """
        )
        data = []
        for row in rows:
            data.append({
                "id": str(row["id"]),
                "opponent": row["opponent"],
                "datetime": row["datetime"],
                "location": row["location"],
                "competition": row["competition"],
                "generation": row["generation"],
                "played": bool(row["played"]),
                "homeScore": row["home_score"],
                "awayScore": row["away_score"],
            })
        return jsonify(data)
    finally:
        conn.close()


@app.route('/api/teams', methods=['GET', 'POST'])
def handle_teams():
    conn = get_db_connection()
    try:
        if request.method == 'POST':
            payload = request.get_json(silent=True) or {}
            name = str(payload.get("name") or "").strip()
            badge = str(payload.get("badge") or "").strip()
            if not name:
                return jsonify({"ok": False, "error": "Team name is required"}), 400

            db_execute(
                conn,
                """
                INSERT INTO teams (name, badge) VALUES (%s, %s)
                ON CONFLICT (name) DO UPDATE SET badge = EXCLUDED.badge
                """,
                (name, badge)
            )
            conn.commit()
            return jsonify({"ok": True, "message": "Team saved successfully"}), 201

        rows = db_fetchall(conn, "SELECT name, badge FROM teams")
        data = {row["name"]: row["badge"] for row in rows}
        return jsonify(data)
    finally:
        conn.close()


@app.route('/api/users/<username>', methods=['GET'])
def get_user(username):
    conn = get_db_connection()
    try:
        row = db_fetchone(
            conn,
            "SELECT username, avatar FROM users WHERE username = %s",
            (username,),
        )
        if not row:
            return jsonify({"ok": False, "error": "User not found"}), 404
        return jsonify({"ok": True, "username": row["username"], "avatar": row["avatar"]})
    finally:
        conn.close()


@app.route('/api/users', methods=['POST'])
@app.route('/api/users/register', methods=['POST'])
def create_user():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()
    password = str(data.get('password') or '').strip()
    avatar = str(data.get('avatar') or '').strip() or None
    if not username or not password:
        return jsonify({"ok": False, "error": "Missing username or password"}), 400

    conn = get_db_connection()
    try:
        existing = db_fetchone(
            conn,
            "SELECT 1 FROM users WHERE username = %s",
            (username,),
        )
        if existing:
            return jsonify({"ok": False, "error": "User exists"}), 409

        db_execute(
            conn,
            "INSERT INTO users (username, password, avatar) VALUES (%s, %s, %s)",
            (username, password, avatar),
        )
        conn.commit()
        return jsonify({"ok": True, "username": username, "avatar": avatar})
    finally:
        conn.close()


@app.route('/api/users/login', methods=['POST'])
def login_user():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()
    password = str(data.get('password') or '').strip()

    conn = get_db_connection()
    try:
        row = db_fetchone(
            conn,
            "SELECT username, avatar FROM users WHERE username = %s AND password = %s",
            (username, password),
        )
        if not row:
            return jsonify({"ok": False, "error": "Wrong username or password"}), 401
        return jsonify({"ok": True, "username": row["username"], "avatar": row["avatar"]})
    finally:
        conn.close()


if __name__ == '__main__':
    if is_postgres():
        try:
            init_db()
        except Exception as e:
            print("Init DB error:", e)
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=False)