# Pantry: a self hosted meal planner, pantry and shopping list for your home server

**English** · [Deutsch](README.de.md)

[![CI](https://github.com/kheirisaleh/pantry/actions/workflows/ci.yml/badge.svg)](https://github.com/kheirisaleh/pantry/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Python 3.12](https://img.shields.io/badge/python-3.12-blue)
![React 19 + TypeScript](https://img.shields.io/badge/react-19%20%2B%20TypeScript-61dafb)
![Self hosted](https://img.shields.io/badge/self%20hosted-Docker-2496ed)

> **You run a server at home and want your kitchen data to stay there? This project was built for you.**
> Pantry plans the week's meals from the dishes your household really cooks, knows what is in the cupboard,
> writes the shopping list from the difference, and tells you what you can cook tonight. Names can be typed in
> English, German or Persian. It runs as one Docker container with a SQLite file.

![Today: dishes you can cook right now and how long the last shop will last](docs/screenshots/today.png)

---

## The story

A household that cooks Persian food in Germany has a particular problem. The recipe is "loobia polo", the
supermarket calls the beans "grüne Bohnen", someone types "loobia" on the phone and someone else types
"لوبیا". Many meal planners assume an English recipe database and a cloud account, and they do not know that you
still have half a bag of rice from last week.

So we built the planner we wanted:

* **It plans with your own dishes.** Type a dish and its ingredients per person, in any of the three languages.
  An optional AI assistant (Google Gemini) fills in names in all three languages, categories, typical piece
  weights, nutrition and a photo in the background. Nothing waits for it.
* **It knows the stock.** Every purchase becomes a batch with its price and date. Cooking takes from the
  oldest batch first, so you always know what is left and what each meal cost.
* **The shopping list writes itself.** It covers exactly the meals in the range you pick, minus what is at home,
  plus a small safety margin for fresh produce, rounded to packages and pieces you can actually buy.
* **It lives at home.** One container, one SQLite file in `./data`, daily backups, the phone on the same Wi-Fi.
  It works in the supermarket with no reception and catches up when you are back online.

If that sounds like your kitchen, keep reading.

## What it does

### Today: what can I cook?

The start page shows the dishes you can make right now from what is at home, and a forecast of how long the
last shop will last at your current pace. "What can I cook?" ranks every dish: first the ones that are possible
and keep the rest of the week's plan intact, then the ones that would use something a later meal needs, then
the ones that miss an ingredient (with exactly what is missing).

| Suggestions | Cooking |
| --- | --- |
| ![Suggestions sorted by what is possible](docs/screenshots/suggestions.png) | ![Cook sheet with amounts and swaps](docs/screenshots/cook.png) |

Cooking a dish lets you change the number of people, pick alternatives (rice or bulgur), include optional
items and adjust amounts. The ingredients come off the stock, the cost is worked out from the real purchase
prices, and nutrition per person is stored.

### Plan the week

Drag dishes between days or reorder them inside a day. A meal is marked as short when the stock will not reach
it, taking every earlier meal into account. Meals that were planned but not cooked move to today at midnight
instead of disappearing. Snacks can be logged per person.

![Week planner with drag and drop](docs/screenshots/plan.png)

### Dishes in three languages

Each dish has ingredients per person, slots with alternatives, optional extras and items counted per dish
instead of per person. Photos come from Wikipedia, Openverse or Pexels and are stored locally.

| Dish book | Dish editor |
| --- | --- |
| ![Dishes with photos and tags](docs/screenshots/dishes.png) | ![Editing a dish](docs/screenshots/dish-editor.png) |

### The pantry

Everything at home, grouped by category, with rough "use soon" hints from typical shelf life. A pantry check
walks through every item so you can confirm what is really left; Pantry reminds you every two weeks. Mark
something as used up or thrown away and it is valued at its purchase price in the reports.

![Pantry grouped by category](docs/screenshots/pantry.png)

### Shopping that works without reception

Build the list from the plan for any range of days, add extras by hand (in any language), and tick items off
in the store with the real amount and price. Going to a second store on the same trip starts a new session
there, so each store keeps its own items and total.
If the phone loses the connection, changes are queued and sent once it is back. When you finish, everything
you bought goes into the pantry, and package and piece sizes are learnt from what you entered.

![Shopping list grouped by aisle with prices](docs/screenshots/shopping.png)

### Reports

Money spent per day, week or month, by store and category, cost per cooked meal and per dish, price history per
item, waste, nutrition per person, and a review of each shopping period: what ran short and what was left over.
Everything can be exported as CSV or one Excel file.

![Reports with spending by week, store and category](docs/screenshots/reports.png)

### Notes, push and Alexa

Pantry leaves notes for things worth knowing: an ingredient missing for tomorrow, food that may need using soon,
nothing planned for the next days, a shopping period that is over, the shop stretching longer than planned.
With push enabled they arrive on your phone. An optional Alexa skill reads and fills the shopping list, plans
dishes and answers "do we have eggs", in English and German ([docs/ALEXA.md](docs/ALEXA.md)).

| Notes | Settings |
| --- | --- |
| ![Notes page](docs/screenshots/notes.png) | ![Settings with assistant, Alexa and automation](docs/screenshots/settings.png) |

### On the phone

The phone layout lives under `/m` and can be added to the home screen as an app.

![Today, plan, shopping and pantry on a phone](docs/screenshots/mobile.png)

The interface is in English; ingredients and dishes show their names in English, German and Persian.

## Pairs well with: Home Gym

[Home Gym](https://github.com/kheirisaleh/homegym) is a self hosted AI workout coach by the same author. When
the two are linked, the coach sees how many calories and how much protein each person ate at home over the last
seven days and uses it in its notes and program reviews.

**Short version:**

1. In Pantry: Settings, Automation and export. Create an API key named "Home Gym" and copy it.
2. In the same panel add a webhook to `http://<home-gym-host>:8090/api/integrations/pantry` for the events
   `meal.cooked`, `meal.uncooked` and `nutrition.daily`. Copy the secret that is shown once.
3. In Home Gym: Settings (admin PIN), "Pantry link". Switch on "Use nutrition from the pantry", set the pantry
   address `http://<pantry-host>:8097`, paste the API key and the webhook secret.
4. Give people the same names in both apps (matching ignores upper and lower case).
5. Press **Test** next to the webhook in Pantry and **Sync now** in Home Gym.

Home Gym then pulls `GET /api/export/nutrition` after every relevant webhook and every six hours. The full
guide, the report format and the signature check are in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md); the
contract is pinned by `tests/test_homegym_contract.py`.

## Quick start

You need Docker with the compose plugin.

```bash
git clone https://github.com/kheirisaleh/pantry.git
cd pantry
./install.sh
```

`install.sh` creates `.env` from `.env.example` if it is missing, creates `data/` and `backups/` owned by user
1000 (the container does not run as root), builds the image and waits until the app answers. By hand:

```bash
cp .env.example .env
mkdir -p data backups && sudo chown -R 1000:1000 data backups
docker compose up -d --build
```

Open `http://<server>:8097` on a computer or `http://<server>:8097/m` on a phone.

**First steps:** the app starts with one person called "User"; rename them in Settings. Add a few dishes with
their ingredients per person, put what you have at home into the pantry, plan the week, and build the
shopping list.

**More people:** there is no button for adding people yet. Add them directly in the database, then pick
"Switch" in Settings on each device:

```bash
docker exec pantry python -c "import sqlite3; c = sqlite3.connect('/data/pantry.db'); c.execute(\"INSERT INTO users(name, color) VALUES ('Jonas', '#8fb8ea')\"); c.commit()"
```

**Updating:** `git pull && docker compose up -d --build`. The database schema is updated on start.

## Configuration

All settings are optional. Put them in `.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | empty | Switches on the AI assistant. A key pasted in Settings overrides it. |
| `GEMINI_MODEL` | `gemini-flash-latest` | Main model. |
| `GEMINI_MODELS` | `gemini-flash-lite-latest,<GEMINI_MODEL>` | Models tried in order when one hits its quota. Can also be set in Settings. |
| `PEXELS_API_KEY` | empty | Adds Pexels to the dish photo search. |
| `ALEXA_SKILL_ID` | empty | Skill id for the Alexa endpoint. Can also be set in Settings. |
| `PUBLIC_URL` | empty | Public HTTPS address, used to show the Alexa endpoint. |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | Contact sent with push notifications. Use your own address. |
| `TZ` | `Europe/Berlin` | Time zone for "today", reminders and the nightly jobs. |
| `BACKUP_KEEP` | `30` | Number of daily database backups to keep. |
| `DATA_DIR`, `BACKUP_DIR` | `/data`, `/backups` | Paths inside the container. |
| `PANTRY_WORKERS` | `1` | `0` turns off the background assistant, scheduler and webhook threads (used by tests). |

Without a Gemini key everything works; new ingredients and dishes keep the name you typed and you fill in unit,
category and nutrition by hand.

Push notifications need the app to be opened over HTTPS (or `localhost`), which is a browser rule. The VAPID key
pair is created on first use and stored in the database.

## Your data

```
data/
  pantry.db                      SQLite database (WAL mode)
  media/recipes/                 dish photos
  exports/nutrition/DATE.json    nightly nutrition export per day
backups/
  pantry-YYYYMMDD.db             daily copy at 3:00, the last 30 are kept
```

To restore, stop the container and copy a backup over `data/pantry.db`. Reports can be exported as CSV
(`/api/export/purchases.csv`, `meals`, `snacks`, `waste`, `inventory`, `recipes`) or as one Excel file
(`/api/export.xlsx`).

## Security

Pantry is meant for a private home network. People have no passwords; anyone who can open the app can use it.
Do not expose it to the internet. If you need Alexa, expose only `/alexa` through a reverse proxy. The
automation endpoints need an API key, webhooks are signed. See [SECURITY.md](SECURITY.md).

## For researchers and tinkerers

* **The rules are plain code.** Unit conversion, the plan simulation, suggestion ranking, shopping list maths,
  FIFO costing and the shopping cycle forecast are explained in [docs/PLANNING_LOGIC.md](docs/PLANNING_LOGIC.md).
  The pure functions in `app/logic.py` have no database access.
* **The AI is fenced in.** The assistant only classifies and describes; its answers are checked against a JSON
  schema and numeric bounds before anything is saved. It never decides quantities.
* **Demo data.** `python tools/demo_seed.py /tmp/pantry-demo` writes six weeks of a made up household (Leila and
  Jonas) without network access. Start the app on it with
  `DATA_DIR=/tmp/pantry-demo PANTRY_WORKERS=0 uvicorn app.main:app`.
* **Your data in other tools.** CSV and Excel exports, an event feed, webhooks and a small automation API for
  Home Assistant or n8n ([docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)).

## Architecture

```
 Browser (desktop /, phone /m)                    Alexa         Home Gym, Home Assistant, n8n
   React 19 + TypeScript, service worker            │                     │
        │  JSON over /api, offline queue            │ /alexa              │ /api/export, /api/automation
        ▼                                           ▼                     ▼  (API key)
 ┌─────────────────────────────── FastAPI (one container) ───────────────────────────────┐
 │ app/routes/*      thin routers                                                        │
 │ app/services.py   ingredients, dishes, plan, cooking, stock, shopping                 │
 │ app/logic.py      pure maths: units, simulation, suggestions, FIFO                    │
 │ app/cycle.py      shopping cycle forecast       app/reports.py   reports and exports  │
 │ app/ai.py         Gemini job queue              app/images.py    photo search         │
 │ app/integrations  API keys, webhooks, events    app/alexa.py     skill                │
 │ app/scheduler.py  nightly jobs, notes, backup   app/push.py      Web Push (VAPID)     │
 └───────────────────────────────────┬───────────────────────────────────────────────────┘
                                     ▼
                              SQLite in ./data
```

The frontend is described in [docs/FRONTEND.md](docs/FRONTEND.md).

## Development

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
ruff check . && ruff format --check .
pytest                                   # backend tests, including the Home Gym contract

cd frontend && npm ci
npm run dev                              # Vite on :5173, proxies to the backend on :8000
npm run typecheck && npm run lint && npm test
npm run build                            # writes ../app/web
npx playwright test                      # end to end against the real backend
```

Run the backend for development with `DATA_DIR=./data-dev uvicorn app.main:app --reload`. CI runs all of the
above plus the Docker build. See [CONTRIBUTING.md](CONTRIBUTING.md).

## FAQ

**Do I need the AI assistant?**
No. It saves typing (names in three languages, nutrition, categories, photos), but every field can be filled in
by hand and the planning maths never uses it.

**Does it count calories for meals eaten out?**
No. Only meals cooked at home and logged snacks are counted.

**Can it read receipts or barcodes?**
No. Purchases are entered while shopping, with the amount and price.

**Can several people use it at once?**
Yes. Each device picks a person, and the pages refresh by themselves. One shopping session is active at a
time; starting one in another store pauses the current one.

**Does it run on a Raspberry Pi or a NAS?**
It is a small Python app with SQLite and builds from official multi architecture base images, so any machine
with Docker should work. It has been tested on x86 64 only.

**How do I move to a new server?**
Copy the `data/` folder and `.env`, then run `./install.sh` there.

## Citation and license

MIT licensed, see [LICENSE](LICENSE). If you use Pantry or its planning rules in your work, see
[CITATION.cff](CITATION.cff). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

---

<sub>Keywords: self hosted meal planner, pantry inventory, grocery list from meal plan, home server kitchen app,
Docker, FastAPI, SQLite, React, offline shopping list PWA, Persian recipes, Iranian food, German supermarket,
nutrition tracking, food cost per meal, FIFO inventory, food waste tracking, Alexa skill shopping list, Home
Assistant webhook, n8n, Gemini, Home Gym companion.</sub>
