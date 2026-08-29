#!/usr/bin/env python3
import json
import os
import sqlite3
from typing import Any

from flask import Flask, jsonify, request

ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "database.db")

app = Flask(__name__)


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
    return jsonify({"ok": True, "message": "API ready"})


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message TEXT NOT NULL,
                ts INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
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
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS teams (
                name TEXT PRIMARY KEY,
                badge TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password TEXT NOT NULL
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


@app.before_request
def ensure_db():
    init_db()


@app.route('/api/health', methods=['GET'])
def health():
    return jsonify({"ok": True, "db": DB_PATH})


@app.route('/api/announcements', methods=['GET'])
def get_announcements():
    conn = get_db_connection()
    try:
        rows = conn.execute(
            "SELECT message, ts FROM announcements ORDER BY ts DESC"
        ).fetchall()
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
            conn.execute("DELETE FROM announcements")
            for item in payload:
                conn.execute(
                    "INSERT INTO announcements (message, ts) VALUES (?, ?)",
                    (item.get("message", ""), int(item.get("ts", 0)))
                )
            conn.commit()
            return jsonify({"ok": True, "data": payload})

        if isinstance(payload, dict):
            conn.execute(
                "INSERT INTO announcements (message, ts) VALUES (?, ?)",
                (payload.get("message", ""), int(payload.get("ts", 0)))
            )
            conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/matches', methods=['GET'])
def get_matches():
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, opponent, datetime, location, competition, generation,
                   played, home_score, away_score
            FROM matches
            ORDER BY datetime ASC
            """
        ).fetchall()
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
            conn.execute("DELETE FROM matches")
            for item in payload:
                conn.execute(
                    """
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
                    )
                )
            conn.commit()
            return jsonify({"ok": True, "data": payload})

        if isinstance(payload, dict):
            match_id = payload.get("id") or f"m_{int(payload.get('datetime', 0) or 0)}"
            conn.execute(
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
                )
            )
            conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/matches/<match_id>', methods=['DELETE'])
def delete_match(match_id):
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM matches WHERE id = ?", (match_id,))
        conn.commit()
        return jsonify({"ok": True})
    finally:
        conn.close()


@app.route('/api/teams', methods=['GET'])
def get_teams():
    conn = get_db_connection()
    try:
        rows = conn.execute("SELECT name, badge FROM teams").fetchall()
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
                conn.execute(
                    "INSERT INTO teams (name, badge) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET badge=excluded.badge",
                    (name, badge),
                )
            conn.commit()
            return jsonify({"ok": True, "data": payload})
        return jsonify({"ok": False, "error": "Expected dict"})
    finally:
        conn.close()


@app.route('/api/users', methods=['POST'])
def create_user():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()
    password = str(data.get('password') or '').strip()
    if not username or not password:
        return jsonify({"ok": False, "error": "Missing username or password"}), 400

    conn = get_db_connection()
    try:
        existing = conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone()
        if existing:
            return jsonify({"ok": False, "error": "User exists"}), 409

        conn.execute("INSERT INTO users (username, password) VALUES (?, ?)", (username, password))
        conn.commit()
        return jsonify({"ok": True, "username": username})
    finally:
        conn.close()


@app.route('/api/users/login', methods=['POST'])
def login_user():
    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()
    password = str(data.get('password') or '').strip()

    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT username FROM users WHERE username = ? AND password = ?",
            (username, password),
        ).fetchone()
        if not row:
            return jsonify({"ok": False, "error": "Wrong username or password"}), 401
        return jsonify({"ok": True, "username": row["username"]})
    finally:
        conn.close()


init_db()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8000))
    app.run(host='0.0.0.0', port=port, debug=False)
