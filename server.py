#!/usr/bin/env python3
import json
import os
import sqlite3
from typing import Any

from flask import Flask, jsonify, request

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    psycopg2 = None

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "database.db")
DATABASE_URL = os.environ.get("DATABASE_URL")

app = Flask(__name__)


def is_postgres() -> bool:
    return bool(DATABASE_URL) and psycopg2 is not None


def require_postgres():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set. Configure Postgres in Render environment variables.")
    if psycopg2 is None:
        raise RuntimeError("psycopg2 is not installed.")
    return DATABASE_URL


@app.after_request
def add_cors_headers(response):
    origin = request.headers.get('Origin')
    allowed_origin = 'https://bakirsehic4-crypto.github.io'
    if origin and origin.startswith('https://bakirsehic4-crypto.github.io'):
        response.headers['Access-Control-Allow-Origin'] = origin
    else:
        response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    response.headers['Access-Control-Max-Age'] = '86400'
    return response


@app.route('/', methods=['GET', 'OPTIONS'])
def index():
    if request.method == 'OPTIONS':
        return '', 200
    if not is_postgres():
        return jsonify({
            "ok": False,
            "message": "DATABASE_URL is missing or Postgres is unavailable.",
            "db": "sqlite"
        }), 500
    return jsonify({"ok": True, "message": "API ready", "db": "postgres"})


def get_db_connection():
    if not is_postgres():
        raise RuntimeError("Postgres is required. Set DATABASE_URL and keep psycopg2 installed.")
    conn = psycopg2.connect(require_postgres(), sslmode="require")
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
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(query, params)
        rows = cur.fetchall()
        cur.close()
        return rows
    return conn.execute(query, params).fetchall()


def db_fetchone(conn, query, params=()):
    if is_postgres():
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
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
                message TEXT NOT NULL,
                ts BIGINT NOT NULL
            )
        """)
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
        if not is_postgres():
            try:
                db_execute(conn, "ALTER TABLE users ADD COLUMN avatar TEXT")
            except sqlite3.OperationalError:
                pass
        conn.commit()
    finally:
        conn.close()


@app.before_request
def ensure_db():
    init_db()


@app.route('/debug-db', methods=['GET'])
def debug_db():
    return jsonify({
        "DATABASE_URL_set": bool(os.environ.get("DATABASE_URL")),
        "psycopg2_importable": psycopg2 is not None,
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
        data = [{"message": row["message"], "ts": row["ts"]} for row in rows]
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
                    "INSERT INTO announcements (message, ts) VALUES (%s, %s)" if is_postgres() else "INSERT INTO announcements (message, ts) VALUES (?, ?)",
                    (item.get("message", ""), int(item.get("ts", 0))),
                )
            conn.commit()
            return jsonify({"ok": True, "data": payload})

        if isinstance(payload, dict):
            db_execute(
                conn,
                "INSERT INTO announcements (message, ts) VALUES (%s, %s)" if is_postgres() else "INSERT INTO announcements (message, ts) VALUES (?, ?)",
                (payload.get("message", ""), int(payload.get("ts", 0))),
            )
            conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/matches', methods=['GET'])
def get_matches():
    conn = get_db_connection()
    try:
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
                "id": row["id"],
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


@app.route('/api/matches', methods=['POST'])
def save_matches():
    payload = request.get_json(silent=True)
    conn = get_db_connection()
    try:
        if isinstance(payload, list):
            db_execute(conn, "DELETE FROM matches")
            for item in payload:
                db_execute(
                    conn,
                    """
                    INSERT INTO matches (id, opponent, datetime, location, competition, generation, played, home_score, away_score)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """ if is_postgres() else """
                    INSERT INTO matches (id, opponent, datetime, location, competition, generation, played, home_score, away_score)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item.get("id"),
                        item.get("opponent", ""),
                        item.get("datetime", ""),
                        item.get("location", "home"),
                        item.get("competition"),
                        item.get("generation"),
                        int(bool(item.get("played", False))),
                        item.get("homeScore"),
                        item.get("awayScore"),
                    ),
                )
            conn.commit()
            return jsonify({"ok": True, "data": payload})

        if isinstance(payload, dict):
            match_id = payload.get("id") or f"m_{int(payload.get('datetime', 0) or 0)}"
            if is_postgres():
                db_execute(
                    conn,
                    """
                    INSERT INTO matches (id, opponent, datetime, location, competition, generation, played, home_score, away_score)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT(id) DO UPDATE SET
                        opponent=EXCLUDED.opponent,
                        datetime=EXCLUDED.datetime,
                        location=EXCLUDED.location,
                        competition=EXCLUDED.competition,
                        generation=EXCLUDED.generation,
                        played=EXCLUDED.played,
                        home_score=EXCLUDED.home_score,
                        away_score=EXCLUDED.away_score
                    """,
                    (
                        match_id,
                        payload.get("opponent", ""),
                        payload.get("datetime", ""),
                        payload.get("location", "home"),
                        payload.get("competition"),
                        payload.get("generation"),
                        int(bool(payload.get("played", False))),
                        payload.get("homeScore"),
                        payload.get("awayScore"),
                    ),
                )
            else:
                db_execute(
                    conn,
                    """
                    INSERT INTO matches (id, opponent, datetime, location, competition, generation, played, home_score, away_score)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        opponent=excluded.opponent,
                        datetime=excluded.datetime,
                        location=excluded.location,
                        competition=excluded.competition,
                        generation=excluded.generation,
                        played=excluded.played,
                        home_score=excluded.home_score,
                        away_score=excluded.away_score
                    """,
                    (
                        match_id,
                        payload.get("opponent", ""),
                        payload.get("datetime", ""),
                        payload.get("location", "home"),
                        payload.get("competition"),
                        payload.get("generation"),
                        int(bool(payload.get("played", False))),
                        payload.get("homeScore"),
                        payload.get("awayScore"),
                    ),
                )
            conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/matches/<match_id>', methods=['DELETE'])
def delete_match(match_id):
    conn = get_db_connection()
    try:
        db_execute(conn, "DELETE FROM matches WHERE id = %s" if is_postgres() else "DELETE FROM matches WHERE id = ?", (match_id,))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/teams', methods=['GET'])
def get_teams():
    conn = get_db_connection()
    try:
        rows = db_fetchall(conn, "SELECT name, badge FROM teams")
        data = {row["name"]: row["badge"] for row in rows}
        return jsonify(data)
    finally:
        conn.close()


@app.route('/api/teams', methods=['POST'])
def save_teams():
    payload = request.get_json(silent=True)
    conn = get_db_connection()
    try:
        if isinstance(payload, dict):
            for name, badge in payload.items():
                if is_postgres():
                    db_execute(
                        conn,
                        "INSERT INTO teams (name, badge) VALUES (%s, %s) ON CONFLICT(name) DO UPDATE SET badge=EXCLUDED.badge",
                        (name, badge),
                    )
                else:
                    db_execute(
                        conn,
                        "INSERT INTO teams (name, badge) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET badge=excluded.badge",
                        (name, badge),
                    )
            conn.commit()
            return jsonify({"ok": True, "data": payload})
        return jsonify({"ok": False, "error": "Expected dict"})
    finally:
        conn.close()


@app.route('/api/users/<username>', methods=['GET'])
def get_user(username):
    conn = get_db_connection()
    try:
        row = db_fetchone(
            conn,
            "SELECT username, avatar FROM users WHERE username = %s" if is_postgres() else "SELECT username, avatar FROM users WHERE username = ?",
            (username,),
        )
        if not row:
            return jsonify({"ok": False, "error": "User not found"}), 404
        return jsonify({"ok": True, "username": row["username"], "avatar": row["avatar"]})
    finally:
        conn.close()


@app.route('/api/users/<username>/avatar', methods=['PUT'])
def update_user_avatar(username):
    data = request.get_json(silent=True) or {}
    avatar = str(data.get('avatar') or '').strip()

    conn = get_db_connection()
    try:
        updated = db_execute(
            conn,
            "UPDATE users SET avatar = %s WHERE username = %s" if is_postgres() else "UPDATE users SET avatar = ? WHERE username = ?",
            (avatar or None, username),
        )
        conn.commit()
        if updated.rowcount == 0:
            return jsonify({"ok": False, "error": "User not found"}), 404
        return jsonify({"ok": True, "username": username, "avatar": avatar or None})
    finally:
        conn.close()


@app.route('/api/users', methods=['POST'])
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
            "SELECT 1 FROM users WHERE username = %s" if is_postgres() else "SELECT 1 FROM users WHERE username = ?",
            (username,),
        )
        if existing:
            return jsonify({"ok": False, "error": "User exists"}), 409

        db_execute(
            conn,
            "INSERT INTO users (username, password, avatar) VALUES (%s, %s, %s)" if is_postgres() else "INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)",
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
            "SELECT username, avatar FROM users WHERE username = %s AND password = %s" if is_postgres() else "SELECT username, avatar FROM users WHERE username = ? AND password = ?",
            (username, password),
        )
        if not row:
            return jsonify({"ok": False, "error": "Wrong username or password"}), 401
        return jsonify({"ok": True, "username": row["username"], "avatar": row["avatar"]})
    finally:
        conn.close()


init_db()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=False)
