import json
import logging
import os
import sqlite3
from datetime import timedelta

from . import db, logic, push, services

log = logging.getLogger("pantry.scheduler")
BACKUP_DIR = os.environ.get("BACKUP_DIR", "/backups")
BACKUP_KEEP = int(os.environ.get("BACKUP_KEEP", "30"))


def _due(task, hour):
    current = services.now()
    if current.hour < hour:
        return False
    return db.get_setting("ran_" + task) != current.date().isoformat()


def _mark(task):
    with db.tx() as c:
        db.set_setting("ran_" + task, services.today().isoformat(), c)


def _alert(c, kind, key, title, body, payload=None):
    cursor = c.execute(
        "INSERT OR IGNORE INTO alerts(kind, dedupe_key, title, body, payload) VALUES (?, ?, ?, ?, ?)",
        (kind, key, title, body, json.dumps(payload or {})),
    )
    return cursor.rowcount


def tomorrow_shortages():
    tomorrow = (services.today() + timedelta(days=1)).isoformat()
    sequence, ingredients = services.planned_sequence(services.today().isoformat(), tomorrow)
    outcome, _ = logic.simulate(services.stock_map(), [(meal["id"], required) for meal, required in sequence])
    meals = {meal["id"]: meal for meal, _ in sequence}
    with db.tx() as c:
        for entry in outcome:
            meal = meals[entry["key"]]
            if meal["date"] != tomorrow or entry["feasible"]:
                continue
            recipe = db.row("SELECT raw_name, name_en FROM recipes WHERE id = ?", (meal["recipe_id"],))
            missing = ", ".join(
                services.display_name(ingredients[key]) + " " + services.format_qty(qty, ingredients[key]["unit"])
                for key, qty in entry["shortages"].items()
            )
            _alert(
                c,
                "tomorrow",
                "tomorrow:" + str(meal["id"]) + ":" + tomorrow,
                "Tomorrow: " + (recipe["name_en"] or recipe["raw_name"]) + " is missing ingredients",
                "Missing " + missing + ".",
                {"meal_id": meal["id"], "date": tomorrow, "ingredients": list(entry["shortages"].keys())},
            )


def expiry_estimates():
    soon = (services.today() + timedelta(days=2)).isoformat()
    found = db.rows(
        "SELECT b.id, b.expires_at, b.ingredient_id, COALESCE(i.name_en, i.raw_name) AS display FROM batches b JOIN ingredients i ON i.id = b.ingredient_id WHERE b.qty_remaining > 0 AND b.expires_at IS NOT NULL AND b.expires_at <= ? AND b.expiry_alerted = 0 AND b.pending_unit IS NULL AND i.kind IN ('food', 'snack')",
        (soon,),
    )
    grouped = {}
    for batch in found:
        grouped.setdefault(batch["ingredient_id"], []).append(batch)
    with db.tx() as c:
        for ingredient_id, batches in grouped.items():
            first = min(batch["expires_at"] for batch in batches)
            _alert(
                c,
                "expiry",
                "expiry:" + ",".join(str(batch["id"]) for batch in batches),
                batches[0]["display"] + " may need using soon",
                "Rough estimate only: bought items like this usually keep until about " + first + ". Check it yourself.",
                {"ingredient_id": ingredient_id, "estimate": first},
            )
            for batch in batches:
                c.execute("UPDATE batches SET expiry_alerted = 1 WHERE id = ?", (batch["id"],))


def stock_count_reminder():
    last = db.get_setting("last_stock_count")
    has_stock = db.scalar("SELECT COUNT(*) FROM batches WHERE qty_remaining > 0")
    if not has_stock:
        return
    if last and services.parse_date(last) > services.today() - timedelta(days=14):
        return
    base = last or db.get_setting("first_stock_count_reminder")
    if not base:
        with db.tx() as c:
            db.set_setting("first_stock_count_reminder", services.today().isoformat(), c)
        base = services.today().isoformat()
    cycle = base + ":" + str((services.today() - services.parse_date(base)).days // 14)
    with db.tx() as c:
        _alert(
            c,
            "stock_count",
            "stock_count:" + cycle,
            "Time for a quick pantry check",
            "It has been two weeks. Confirm what is really left so the plan stays accurate.",
        )


def planning_reminder():
    horizon = (services.today() + timedelta(days=3)).isoformat()
    planned = db.scalar(
        "SELECT COUNT(*) FROM meals WHERE status = 'planned' AND date BETWEEN ? AND ?", (services.today().isoformat(), horizon)
    )
    if planned:
        return
    recent = db.scalar("SELECT COUNT(*) FROM alerts WHERE kind = 'plan' AND created_at >= datetime('now', '-3 days')")
    if recent:
        return
    with db.tx() as c:
        _alert(
            c,
            "plan",
            "plan:" + services.today().isoformat(),
            "Nothing planned for the next days",
            "Pick a few meals so the shopping list can be built.",
        )


def period_reports():
    finished = db.rows(
        "SELECT * FROM shopping_lists WHERE range_end IS NOT NULL AND range_end < ? AND report_sent = 0", (services.today().isoformat(),)
    )
    with db.tx() as c:
        for shopping in finished:
            _alert(
                c,
                "period",
                "period:" + str(shopping["id"]),
                "Your plan " + shopping["range_start"] + " to " + shopping["range_end"] + " is over",
                "See what ran short and what is left over.",
                {"list_id": shopping["id"]},
            )
            c.execute("UPDATE shopping_lists SET report_sent = 1 WHERE id = ?", (shopping["id"],))


def push_new_alerts():
    fresh = db.rows("SELECT * FROM alerts WHERE pushed = 0 AND status = 'open' ORDER BY id")
    if not fresh:
        return
    with db.tx() as c:
        c.execute("UPDATE alerts SET pushed = 1 WHERE pushed = 0")
    if len(fresh) == 1:
        push.broadcast(fresh[0]["title"], fresh[0]["body"] or "", "/m/alerts")
    else:
        push.broadcast(str(len(fresh)) + " new pantry notes", "; ".join(alert["title"] for alert in fresh[:3]), "/m/alerts")


def backup():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    target = os.path.join(BACKUP_DIR, "pantry-" + services.today().strftime("%Y%m%d") + ".db")
    destination = sqlite3.connect(target)
    try:
        db.conn().backup(destination)
    finally:
        destination.close()
    files = sorted(name for name in os.listdir(BACKUP_DIR) if name.startswith("pantry-") and name.endswith(".db"))
    for old in files[:-BACKUP_KEEP]:
        os.remove(os.path.join(BACKUP_DIR, old))


def nutrition_export():
    from . import integrations

    integrations.daily_export()


TASKS = [
    ("rollover", 0, services.roll_forward_meals),
    ("backup", 3, backup),
    ("nutrition_export", 4, nutrition_export),
    ("period", 8, period_reports),
    ("expiry", 9, expiry_estimates),
    ("stock_count", 10, stock_count_reminder),
    ("plan", 10, planning_reminder),
    ("tomorrow", 18, tomorrow_shortages),
]


def tick():
    for name, hour, task in TASKS:
        if _due(name, hour):
            try:
                task()
            except Exception:
                log.exception("Scheduled task %s failed", name)
            _mark(name)
    try:
        push_new_alerts()
    except Exception:
        log.exception("Push failed")


def worker(stop_event):
    while not stop_event.is_set():
        try:
            tick()
        except Exception:
            log.exception("Scheduler loop error")
        stop_event.wait(120)
