# Pantry

Self hosted meal planner, shopping list and household pantry for the home server.

Plan dishes on a calendar, build the shopping list from the plan minus what is at home, tick items off in the shop with prices and a live total, and let the pantry update itself when you cook. Gemini fills in names, translations, nutrition and icons in the background; the app works fully without it.

## Run

    cp .env.example .env
    docker compose up -d --build

Desktop: `/`, phone: `/m/` (add to home screen). Tests: `python -m pytest tests`.

## Alexa

`alexa/` holds the skill manifest and interaction models (en-US, en-GB, de-DE). Create a custom skill in the Alexa developer console, import the models, set the endpoint to the public `/alexa` path and put the skill id in `ALEXA_SKILL_ID`.
