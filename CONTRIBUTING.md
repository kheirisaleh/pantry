# Contributing

Thanks for helping. Issues and pull requests in English or German are welcome.

## Before you start

* For larger changes open an issue first so we can agree on the approach.
* Changes to the planning rules (units, simulation, suggestions, shopping list, costs, nutrition) need an update
  of `docs/PLANNING_LOGIC.md` and a test in `tests/test_logic.py` or the matching API test.
* Do not change the nutrition export or the webhook format without checking
  `tests/test_homegym_contract.py`; [Home Gym](https://github.com/kheirisaleh/homegym) depends on them.

## Workflow

1. Fork and create a branch from `main`.
2. Backend: `pip install -r requirements-dev.txt`, then `ruff check .`, `ruff format --check .` and `pytest`.
3. Frontend: `cd frontend && npm ci`, then `npm run typecheck`, `npm run lint`, `npm test`.
4. For user facing changes run `npm run build && npx playwright test` and add a test for the new behaviour.
5. Open a pull request. CI runs all of the above plus the Docker build.

Screenshots in `docs/screenshots` are taken from the demo data (`tools/demo_seed.py`) with
`frontend/scripts/screenshots.mjs`. Never use real household data or keys in screenshots or tests.

## Style

* Python: ruff settings in `pyproject.toml`. Routers stay thin; logic lives in `app/services.py` and pure maths
  in `app/logic.py`.
* TypeScript: strict mode, ESLint with type checked rules, no `any`.
* Keep pure logic in `frontend/src/lib` and cover it with Vitest; pages only compose.
* UI text is English; keep the tone short and friendly.
