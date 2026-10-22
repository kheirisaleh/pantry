# Integrations

Pantry can share what happens in your kitchen with other services on your home network: the gym app
[Home Gym](https://github.com/kheirisaleh/homegym), Home Assistant, n8n, or your own scripts. There are three ways
in, all managed under **Settings, Automation and export**:

| Way | Direction | Good for |
| --- | --- | --- |
| API key + endpoints | another service asks Pantry | daily nutrition, the current plan, adding items |
| Webhooks | Pantry calls another service | reacting right away when a meal is cooked or a day is exported |
| Event feed | another service polls Pantry | tools that cannot receive webhooks |

## API keys

Create a key under **API keys**. It is shown once; Pantry only stores a SHA-256 hash and the last four characters.
Send it as a header:

```
Authorization: Bearer pk_...
```

`?token=pk_...` in the query string also works, for tools that cannot set headers. Revoking a key stops every
caller using it right away. Each successful call updates the "last used" date in the list.

## Endpoints that need a key

| Method and path | What it returns or does |
| --- | --- |
| `GET /api/export/nutrition?date=YYYY-MM-DD` | nutrition of one day, one report per person |
| `GET /api/export/nutrition?start=…&end=…` | the same for a range, at most 120 days; default is the last 7 days |
| `GET /api/export/nutrition?…&user=ID` | only one person |
| `GET /api/export/nutrition/daily?start=…&end=…` | the stored nightly exports (default: last 30 days), with `final` and `exported_at` |
| `GET /api/automation/events?after=ID&types=a,b&limit=N` | the event feed, see below |
| `GET /api/automation/state` | today, the next 7 days of the plan, the open shopping list and open notes |
| `GET /api/automation/tomorrow?lang=en\|de` | tomorrow's planned dishes, what is missing, and a spoken sentence |
| `POST /api/automation/shopping` | add an item: `{"name": "milk", "qty": 1, "unit": "l"}` |
| `POST /api/automation/meals` | plan a dish: `{"dish": "loobia polo", "date": "2026-10-24", "servings": 2}` or `{"recipe_id": 3}` |

Shopping items added this way carry an "Automation" chip on the shopping list.

### The nutrition report

```json
{
  "days": [
    {
      "date": "2026-10-21",
      "user": { "id": 1, "name": "Leila" },
      "totals": { "kcal": 1834.2, "protein": 71.5, "fat": 52.0, "carbs": 240.1, "fiber": 21.3 },
      "complete": true,
      "entries": [
        { "type": "meal", "meal_id": 42, "name": "Loobia Polo", "name_fa": "لوبیا پلو", "portion": 1, "kcal": 571.7, "protein": 31.4, "fat": 15.6, "carbs": 75.1, "fiber": 4.3 },
        { "type": "snack", "name": "Apple", "qty": 1.0, "unit": "pcs", "kcal": 95.0, "protein": 0.5, "fat": 0.3, "carbs": 25.0, "fiber": 4.0 }
      ],
      "note": "Meals are split evenly by the number of servings cooked."
    }
  ]
}
```

How the numbers are made:

* Only meals marked as cooked count. Each person is given one serving of every meal cooked that day: the meal's
  nutrition divided by the number of servings it was cooked for.
* A snack logged by a person counts fully for that person. A snack logged without a person is split between
  everyone.
* `complete` is `false` when any meal or snack on that day lacks nutrition values (for example an ingredient the
  assistant has not filled in yet). Totals then only add up what is known.
* Eating out is not tracked; nothing outside the pantry is counted.

### Nightly export

Every night at 4:00 (in the `TZ` time zone) Pantry stores the finished report of the previous day per person and
an interim report of the current day. The files land in `data/exports/nutrition/YYYY-MM-DD.json`, the same data
is served by `/api/export/nutrition/daily`, and a `nutrition.daily` event is sent. **Export now** in the settings
runs the same step on demand.

## Webhooks

Add a webhook with an address (`http://` or `https://`) and the events you want (the list allows several
choices; "All events", or no choice at all, sends everything). The secret is shown once when the webhook is
created.

Each delivery is a `POST` with a JSON body:

```json
{ "type": "meal.cooked", "at": "2026-10-21 19:02:11", "id": 381, "data": { "meal_id": 42, "date": "2026-10-21", "dish": "Loobia Polo", "servings": 2, "kcal": 1143.4, "protein": 62.8, "shortfalls": [] } }
```

and these headers:

| Header | Content |
| --- | --- |
| `X-Pantry-Event` | the event type |
| `X-Pantry-Timestamp` | Unix time in seconds |
| `X-Pantry-Signature` | `sha256=` + hex HMAC-SHA256 of `timestamp + "." + raw body`, keyed with the secret |

To verify in Python:

```python
import hashlib, hmac, time


def verify(secret, raw_body, timestamp, signature):
    if abs(time.time() - int(timestamp)) > 600:
        return False
    expected = "sha256=" + hmac.new(secret.encode(), (timestamp + ".").encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

A delivery counts as successful on any 2xx answer. A failed delivery is retried three more times, after 5, 10
and 20 seconds. The queue lives in memory, so deliveries still waiting are lost when the container restarts; the
event feed below keeps the history. **Test** sends a `test` event even to a paused webhook and shows the answer.

### Event types

| Type | When | `data` |
| --- | --- | --- |
| `meal.planned` | a dish is planned | `meal_id`, `date`, `position`, `servings`, `recipe_id`, `dish` |
| `meal.moved` | a planned dish is dragged | same as above |
| `meal.updated` | people, day or dish of a planned meal change | same as above |
| `meal.removed` | a planned meal is removed | `meal_id` |
| `meal.cooked` | a meal is cooked | `meal_id`, `date`, `dish`, `servings`, `kcal`, `protein`, `shortfalls` |
| `meal.uncooked` | cooking is undone | `meal_id` |
| `shopping.item_added` | something is put on the list | `item_id`, `ingredient_id`, `name`, `needed_qty`, `unit` |
| `shopping.list_built` | the list is built from the plan | `start`, `end` |
| `stock.used_up` | an item is marked as used up | `ingredient_id` |
| `recipe.created` | a dish is added | `recipe_id`, `name` |
| `nutrition.daily` | the nightly export | `date`, `people` with `user`, `totals`, `complete` |

`shopping.finished` and `stock.added` are listed in the settings and accepted by the API, but nothing sends them yet.

## Event feed

`GET /api/automation/events?after=0` returns up to 200 events (at most 500 with `limit`) after the given id, plus
`last_id` to use in the next call. `types=meal.cooked,nutrition.daily` filters. Pantry keeps the latest 5000
events.

---

## Pairs well with: Home Gym

[Home Gym](https://github.com/kheirisaleh/homegym) is a self hosted AI workout coach by the same author. With the
link turned on, its coach sees how many calories and how much protein each person ate at home over the last 7
days, and uses that in its notes and program reviews. With at least four logged days it also works out protein
per kilogram of body weight and says so when protein looks low for the goal.

### How the two talk

```
 Pantry                                              Home Gym
   │  POST /api/integrations/pantry  (webhook)          │
   │  meal.cooked, meal.uncooked, nutrition.daily ────► │  "something changed, sync that day"
   │                                                    │
   │ ◄──── GET /api/export/nutrition?start=…&end=…      │  pulls the reports with the API key
   │       Authorization: Bearer pk_…                   │  (that day after a webhook with a date,
   │                                                    │   otherwise the last 14 days; also every 6 hours)
```

People are matched **by name**, ignoring upper and lower case. "Leila" in Pantry becomes "leila" in Home Gym.

### Step by step

1. **Pantry, create a key.** Settings, Automation and export, API keys: name it "Home Gym", press **Create key**
   and copy it.
2. **Pantry, add the webhook.** In the same panel under Webhooks enter the Home Gym address shown in its settings,
   usually `http://<home-gym-host>:8090/api/integrations/pantry`. Select `meal.cooked`, `meal.uncooked` and
   `nutrition.daily` (or All events, Home Gym ignores the rest). Press **Add webhook** and copy the secret.
3. **Home Gym, fill in the "Pantry link".** Open Settings with the admin PIN:

   | Home Gym setting | Value |
   | --- | --- |
   | Use nutrition from the pantry | on |
   | Pantry address | `http://<pantry-host>:8097` |
   | Pantry API key | the `pk_…` key from step 1 |
   | Pantry webhook secret | the `whsec_…` secret from step 2 |

   The same values can be set as environment variables of the Home Gym container:
   `PANTRY_ENABLED=1`, `PANTRY_URL`, `PANTRY_TOKEN`, `PANTRY_WEBHOOK_SECRET`.
4. **Use the same names.** Rename people in Pantry (Settings, People) so they match the Home Gym profiles.
5. **Check it.** Press **Test** next to the webhook in Pantry: Home Gym answers with `200` and the webhook shows
   "Last: 200". Press **Sync now** in Home Gym's settings: it answers "Synced N person days from the pantry".
   Only people whose names match are counted.

If both containers are attached to a shared Docker network you can use container names instead of host names, for example
`http://workout-tracker:8000/api/integrations/pantry` and `http://pantry:8000`. When Home Gym has no webhook
secret set it accepts unsigned calls; set one so other devices on the network cannot trigger syncs.

The contract between the two apps is pinned by `tests/test_homegym_contract.py`, which copies the code Home Gym
uses to read the export and check signatures.
