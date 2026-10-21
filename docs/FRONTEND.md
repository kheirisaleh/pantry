# Frontend

The web app lives in `frontend/` and is a single React 19 + TypeScript app built with Vite. `npm run build`
writes it to `app/web`; FastAPI serves those files and falls back to `index.html` for every other page path. The
same build serves the desktop layout and the phone layout.

## Layout

| Folder | What lives there |
| --- | --- |
| `src/lib` | Framework free code: API client, offline queue, types, formatting, shopping and kitchen helpers, the store, `useResource`, route helpers. Everything here has unit tests. |
| `src/ui` | Shared building blocks: sheet (modal) and toast hosts, icons, charts, form controls such as the ingredient picker and unit selects. |
| `src/app` | Session (who is using this device), router, desktop and mobile shells, push subscription, offline pill, auto refresh. |
| `src/features` | Pieces used by several pages: cook, meal and snack sheets, suggestions, recipe and ingredient editors, image chooser, shopping store, stock count, drag and drop in the planner, settings panels. |
| `src/pages` | One file per screen: Today, Plan, Recipes, Pantry, Shop, Reports, Alerts (shown as "Notes"), Settings. Pages only compose. |
| `src/styles` | `base.css`, plus `desktop.css` and `mobile.css` scoped with `:where(body.mobile)` so the scoping adds no specificity, and `polish.css` for small fixes. |
| `scripts` | `icons.mjs` copies the used Fluent Emoji and UI icons into `public/icons`; `screenshots.mjs` takes the screenshots in `docs/screenshots`. |
| `e2e` | Playwright tests. `e2e/server.py` starts the real backend on a temporary database with the network off and a fake assistant. |

## Routing

Desktop pages live at `/`, `/plan`, `/recipes` and so on; phone pages under `/m`. On a phone (narrow screen and
an iPhone or Android browser) the desktop paths redirect to `/m`, unless the person chose to stay on desktop.
Old hash links such as `/#/plan` are rewritten on load. Pages are code split; Chart.js loads in its own chunk
only on pages with charts.

## Data

`useResource(fetcher, deps, tags)` loads data, cancels stale requests with an `AbortController` and keeps the
last result while reloading. After a write, `invalidate("plan", "shop", ...)` reloads every page that listens to
those tags (`boot`, `plan`, `recipes`, `pantry`, `shop`, `alerts`, `reports`, `settings`). Pages also refresh
when the tab becomes visible again and once a minute while visible (not while a sheet is open, while typing, or
on the shopping page), so two people using the app at once stay in sync.

The person using the device is chosen once and sent as `X-User-Id`; it decides who cooked, who shopped and
whose snack it was.

## Offline shopping

Supermarkets often have bad reception. Writes on the shopping page go through `mutate` in `src/lib/offline.ts`:
when the network fails, the request is stored in `localStorage` with an `X-Op-Id`, the screen updates right
away, and new items or sessions get temporary ids (`tmp-i-…`, `tmp-s-…`). When the browser is online again the
queue is sent in order, temporary ids are replaced with the real ones, and the backend's idempotency middleware
makes sure a request that was sent twice is applied once. An "Offline" pill shows how many changes are waiting.

The service worker (`public/sw.js`) caches the app shell, icons, recipe images and the last answer of each
`GET /api/...` call, so the app opens and shows the last list without a connection. It also shows push
notifications and opens the phone app when one is tapped.

## Accessibility and motion

Interactive parts are buttons or links with labels, sheets trap focus, close on Escape (and with a swipe on the
phone) and lock page scroll, the focus ring is an outline that does not move layout, and animations respect
`prefers-reduced-motion`.

## Commands

```bash
cd frontend
npm ci
npm run dev           # Vite on :5173, proxies /api, /media and /alexa to PANTRY_BACKEND (default http://127.0.0.1:8000)
npm run typecheck
npm run lint          # ESLint with type checked rules, zero warnings allowed
npm test              # Vitest
npm run build         # icons, type check, bundle to ../app/web
npx playwright test   # end to end, needs a build
```
