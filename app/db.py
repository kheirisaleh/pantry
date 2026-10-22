import os
import sqlite3
import threading
from contextlib import contextmanager

DATA_DIR = os.environ.get("DATA_DIR", "/data")
DB_PATH = os.path.join(DATA_DIR, "pantry.db")

_local = threading.local()
_write_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#ff7a59',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY,
    raw_name TEXT NOT NULL,
    name_en TEXT,
    name_fa TEXT,
    name_de TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    kind TEXT NOT NULL DEFAULT 'food',
    unit TEXT NOT NULL DEFAULT 'g',
    sold_by_piece INTEGER NOT NULL DEFAULT 0,
    piece_amount REAL,
    kcal REAL,
    protein REAL,
    fat REAL,
    carbs REAL,
    fiber REAL,
    tolerance_pct REAL NOT NULL DEFAULT 0,
    unit_locked INTEGER NOT NULL DEFAULT 0,
    shelf_days INTEGER,
    icon TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    ai_error TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aliases (
    alias TEXT PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY,
    raw_name TEXT NOT NULL,
    name_en TEXT,
    name_fa TEXT,
    description TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    cook_minutes INTEGER,
    image_query TEXT,
    image_path TEXT,
    image_source TEXT,
    image_candidates TEXT,
    image_status TEXT NOT NULL DEFAULT 'none',
    status TEXT NOT NULL DEFAULT 'pending',
    ai_error TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_items (
    id INTEGER PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    amount REAL NOT NULL,
    unit TEXT NOT NULL DEFAULT 'g',
    optional INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meals (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id),
    servings REAL NOT NULL DEFAULT 2,
    status TEXT NOT NULL DEFAULT 'planned',
    choices TEXT NOT NULL DEFAULT '{}',
    optional_items TEXT NOT NULL DEFAULT '[]',
    cooked_by INTEGER REFERENCES users(id),
    cooked_at TEXT,
    cost REAL,
    kcal REAL,
    protein REAL,
    fat REAL,
    carbs REAL,
    fiber REAL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS meals_date ON meals(date, position);

CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    qty_initial REAL NOT NULL,
    qty_remaining REAL NOT NULL,
    price_total REAL,
    store TEXT,
    purchased_at TEXT NOT NULL,
    expires_at TEXT,
    source TEXT NOT NULL,
    pending_unit TEXT,
    session_id INTEGER,
    created_by INTEGER REFERENCES users(id),
    expiry_alerted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS batches_ingredient ON batches(ingredient_id, qty_remaining);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    batch_id INTEGER,
    kind TEXT NOT NULL,
    qty REAL NOT NULL,
    value REAL NOT NULL DEFAULT 0,
    meal_id INTEGER,
    user_id INTEGER REFERENCES users(id),
    at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_kind_at ON events(kind, at);

CREATE TABLE IF NOT EXISTS snacks (
    id INTEGER PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    qty REAL NOT NULL,
    date TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    kcal REAL,
    protein REAL,
    fat REAL,
    carbs REAL,
    fiber REAL,
    cost REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shopping_lists (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'open',
    range_start TEXT,
    range_end TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT,
    report_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS shopping_items (
    id INTEGER PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
    auto INTEGER NOT NULL DEFAULT 0,
    needed_qty REAL,
    note TEXT,
    checked INTEGER NOT NULL DEFAULT 0,
    bought_qty REAL,
    bought_unit TEXT,
    price REAL,
    session_id INTEGER,
    committed INTEGER NOT NULL DEFAULT 0,
    added_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shopping_sessions (
    id INTEGER PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES shopping_lists(id),
    store TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    user_id INTEGER REFERENCES users(id),
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    body TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'open',
    pushed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_jobs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_at TEXT NOT NULL DEFAULT (datetime('now')),
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(kind, target_id, status)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS processed_ops (
    op_id TEXT PRIMARY KEY,
    response TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def connect(path=None):
    connection = sqlite3.connect(path or DB_PATH, timeout=30, check_same_thread=False, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 30000")
    return connection


def conn():
    current = getattr(_local, "connection", None)
    if current is None or getattr(_local, "path", None) != DB_PATH:
        current = connect()
        _local.connection = current
        _local.path = DB_PATH
    return current


def set_path(path):
    global DB_PATH
    DB_PATH = path
    _local.connection = None


def init():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    connection = conn()
    connection.executescript(SCHEMA)
    for statement in (
        "ALTER TABLE ingredients ADD COLUMN package_amount REAL",
        "ALTER TABLE recipe_items ADD COLUMN per_dish INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE recipes ADD COLUMN name_de TEXT",
        "ALTER TABLE shopping_items ADD COLUMN source TEXT NOT NULL DEFAULT 'app'",
        "ALTER TABLE meals ADD COLUMN source TEXT NOT NULL DEFAULT 'app'",
        "ALTER TABLE shopping_items ADD COLUMN pack_size REAL",
        "ALTER TABLE shopping_items ADD COLUMN unit_price REAL",
    ):
        try:
            connection.execute(statement)
        except sqlite3.OperationalError:
            pass
    if not connection.execute("SELECT 1 FROM users LIMIT 1").fetchone():
        connection.execute("INSERT INTO users(name, color) VALUES ('User', '#ff7a59')")


@contextmanager
def tx():
    connection = conn()
    with _write_lock:
        connection.execute("BEGIN IMMEDIATE")
        try:
            yield connection
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise


def rows(sql, params=()):
    return [dict(row) for row in conn().execute(sql, params).fetchall()]


def row(sql, params=()):
    found = conn().execute(sql, params).fetchone()
    return dict(found) if found else None


def scalar(sql, params=()):
    found = conn().execute(sql, params).fetchone()
    return found[0] if found else None


def get_setting(key, default=None):
    value = scalar("SELECT value FROM settings WHERE key = ?", (key,))
    return default if value is None else value


def set_setting(key, value, connection=None):
    (connection or conn()).execute(
        "INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, str(value)),
    )
