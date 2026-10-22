# Planning logic

This page explains how Pantry turns a meal plan and a stock of ingredients into suggestions, shopping lists,
costs, nutrition and forecasts. Everything described here is plain Python in `app/logic.py`, `app/services.py`,
`app/cycle.py` and `app/integrations.py`; the AI assistant never decides quantities. The pure functions in
`app/logic.py` have no database access and are the easiest place to start reading or experimenting
(`tests/test_logic.py` shows them in action).

## Units

Every ingredient has one **base unit**: `g`, `ml` or `pcs`. Stock, recipe needs and shopping quantities are all
converted to it by `to_base`:

| Input | Conversion |
| --- | --- |
| `kg`, `l` | × 1000 to `g`, `ml` |
| `tbsp`, `tsp` | 15 and 5, counted as `g` or `ml` (whichever is the base) |
| `g` ↔ `ml` | treated as equal (1 g ≈ 1 ml) |
| `pcs` ↔ `g`/`ml` | needs `piece_amount` (weight of one piece) |
| `jar`, `can`, `pack` | needs `package_amount` (content of one package) |

When a conversion is impossible (a piece weight is unknown) the amount is kept as **pending** and is not counted
until the size is known. Pantry learns sizes from shopping: if you planned 400 g of tomatoes and ticked off
"3 pcs", it stores `piece_amount = 133.3 g` and converts the pending stock (`learn_size`). Once an ingredient has
stock, its base unit is locked so old amounts keep their meaning.

Nutrition is stored per 100 g or 100 ml for `g`/`ml` ingredients (the way EU food labels declare it) and per
piece for `pcs` ingredients.

## What counts

Only ingredients of kind `food` that are not archived take part in planning. `staple` (salt, oil, spices),
`snack` and `household` items can be kept and bought but never create shortages. Recipe amounts are per person
and are multiplied by the meal's servings, unless an item is marked "per dish". For slots with alternatives
(rice or bulgur) the meal's choice is used, otherwise the default; optional items count only when selected.

## Simulation

The plan is a sequence of meals ordered by day and position. `simulate` walks through it with a running copy of
the stock, subtracts each meal's needs, and records what was short. This is what colours planned meals red or
green, what the "Tomorrow" note checks at 18:00, and the basis of everything below.

Planned meals from past days that were never cooked move to today at midnight (`roll_forward_meals`), so the
plan never silently forgets food you meant to cook.

## Suggestions

When you pick a dish for a day, every dish in the book is ranked by `rank_suggestions`, starting from the stock
that will be left on that day:

| Tier | Meaning |
| --- | --- |
| 0 | can be cooked and keeps every later planned meal possible |
| 1 | can be cooked, but would make a later planned meal short |
| 2 | something is missing for this dish itself |

Within a tier, fewer missing ingredients come first, then fewer broken later meals, then dishes already planned
in the coming days, then the dish cooked longest ago, then the name. If a dish is already planned later, the
simulation skips that later copy, because cooking it now just pulls it forward.

## Shopping list

`build_list(start, end)` buys for the meals between `start` and `end`:

1. Needs of planned meals **before** `start` are reserved first; that stock is not free.
2. For each ingredient: `need = demand × (1 + tolerance) − free stock`, where tolerance is a per ingredient
   safety margin (10 to 20 % for fresh produce, 0 to 5 % for rice or meat, set by the assistant and editable).
3. If the reserved meals already need more than the stock, that gap is added too.
4. The result is rounded to something you can buy (`round_purchase`): whole packages when a package size is
   known, whole pieces for `pcs` items or produce sold by the piece, otherwise up to the next whole gram or
   millilitre.

The automatic part of the list is recomputed whenever the plan or stock changes; items you added by hand stay.
Items already ticked off but not yet committed count as stock, so the list does not ask for them twice.

## Shopping trips and stock

A trip is a **session**: tick items off, optionally enter what you really bought and the price, pause, resume,
and finish. Finishing adds one **batch** per item to the stock with its price, store and date. A trip to two
stores is two sessions on the same list; starting a new one pauses the active one.

Cooking takes ingredients from the oldest batches first (**FIFO**). The cost of a meal is the sum of
`price / initial quantity × used quantity` over the batches it touched, so a meal cooked with rice bought at two
prices is costed exactly. Missing amounts are recorded as shortfalls and cost nothing. Waste uses the same path
and is valued the same way, which is what the waste figures in Reports show. A stock count corrects the stock
up or down to what you really have.

## Nutrition per person

A cooked meal stores its total nutrition. For a day, each person in the household is given one serving of every
cooked meal: total divided by the servings it was cooked for. A snack logged by a person counts for that person;
a snack without a person is split evenly across everyone. When an ingredient has no nutrition values yet, the
day is marked incomplete and only known values are summed. This is the report that Home Gym reads; see
[INTEGRATIONS.md](INTEGRATIONS.md).

## Shopping cycle forecast

The Today page shows whether the last shop will last as long as planned (`app/cycle.py`):

* **Planned length**: the date range of the last shopping list (or the last used length, 14 days by default).
* **Meals left**: starting from today's stock, the simulation greedily cooks the dish that has been used least
  so far, as long as any dish in the book still fits, up to 120 meals.
* **Pace**: meals cooked per day since the trip once there are at least two, otherwise the planned meals per day,
  otherwise one per day.
* **Forecast**: `meals left ÷ pace` days from today, compared with the planned end. More than a day early raises
  "Food runs out early"; still cooking after the planned end raises "Well done, the shop is stretching", with the
  money saved estimated as the trip's spend per planned day times the extra days.

## Notes and reminders

The scheduler (`app/scheduler.py`) runs these once a day at a fixed hour in the `TZ` time zone, and each new
note is sent as a push notification:

| Hour | Task |
| --- | --- |
| 0 | move overdue planned meals to today |
| 3 | database backup to `BACKUP_DIR`, keeping the last `BACKUP_KEEP` files |
| 4 | nightly nutrition export |
| 8 | "Your plan … is over" when a shopping range has ended |
| 9 | rough expiry estimates for food bought `shelf_days` ago, two days ahead |
| 10 | pantry count reminder every two weeks; "Nothing planned" when the next three days are empty |
| 18 | "Tomorrow: … is missing ingredients" for each planned meal of tomorrow that is short |

Expiry dates are estimates from typical shelf life, never read from a label, and the note says so.

## The AI assistant and its guard rails

Typing "loobia", "Bohnen" or "لوبیا" creates an ingredient right away; the Gemini assistant fills in the rest in
the background through a job queue (`app/ai.py`). Its answer is constrained by a JSON schema and then checked
before anything is saved:

* `same_as_id` merges the new entry into an existing one when it is clearly the same product (stock, recipes and
  list items move over and the typed text becomes an alias).
* Unit, category and kind must come from fixed lists, and a locked unit is never changed.
* Nutrition must lie within fixed bounds (for example at most 900 kcal and 100 g protein per 100 g), and protein,
  fat and carbs together may not exceed 101 g per 100 g; otherwise all nutrition values are dropped rather than
  saved wrong.
* Piece weight, tolerance (0 to 50 %) and shelf life (1 to 3650 days) are range checked; an unknown icon falls
  back to the category icon.
* If the assistant cannot tell what the text means, the ingredient is marked for manual editing instead of
  guessed.

Dishes get names in English, Persian and German, a short description, tags, cooking time and an image search
query. Images come from Wikipedia, Openverse and Pexels (when `PEXELS_API_KEY` is set), only over HTTPS, at
most 8 MB, as JPEG, PNG or WebP, and are stored locally under `data/media/recipes`.

When a model hits its quota, the queue waits and tries the next configured model; when all models answer
"not found", the settings say so instead of reporting a quota problem.
