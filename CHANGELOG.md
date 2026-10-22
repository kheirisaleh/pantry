# Changelog

## Unreleased

* Web app rebuilt in React 19 and TypeScript with one router for the desktop (`/`) and phone (`/m`) layouts,
  an offline queue for shopping and tag based reloading.
* Backend split into routers; bugs fixed in validation (ingredients, dishes, stock counts, prices, webhooks),
  units for new items added by Alexa, the time zone setting and the Gemini model fallback message.
* Test suites for backend (pytest, including a contract test for the Home Gym link), frontend (Vitest) and end
  to end (Playwright), plus a demo data seed and screenshots.
* Two stage Docker image running as a non root user, `install.sh`, and GitHub Actions CI.
* Bilingual README (English and German), guides for integrations, Alexa, planning logic and the frontend,
  citation metadata and `llms.txt`.

## Initial public release

* First public version: FastAPI backend with a plain JavaScript web app.
