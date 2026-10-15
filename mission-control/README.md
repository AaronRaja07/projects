# Mission Control

A delivery decision workspace for a fictional multi-team software program, presented as the **Northstar Delivery Tracker**. A compact light interface, blue header, horizontal navigation, and a dark sprint snapshot support twelve primary tabs and two supporting views. All implementation and records were independently authored.

A delivery lead can inspect blockers, test commitments against capacity, explore forecast uncertainty, coordinate reviews, and trace a readout to its underlying stories. The interface shares one story model across its metrics, tables, exports, assistant evidence, and integrity checks.

## Run locally

From the repository root, with Python 3.10 or newer:

```sh
python3 server.py
```

Open [Mission Control](http://127.0.0.1:8000/mission-control/). No packages, credentials, or external accounts are required. The local server binds to loopback.

## Hosted edition and persistence

The hosted edition is a standalone static browser sandbox. It loads the Python-generated fixture from `seed.js`, and `browser-service.js` implements the demo API in JavaScript. It does not send dashboard mutations to a Python service or a cloud database.

| Mode | Computation | Saved edits |
| --- | --- | --- |
| Local Python server | `service.py` through `/api/mission` | Ignored `.demo-state/mission.json` on the local machine |
| Hosted browser demo | `browser-service.js` intercepts the same interface calls | `localStorage` in that browser and site origin |

The two modes do not synchronize state. The hosted edition has no accounts, shared workspace, or multiuser backend. If browser storage is unavailable, a warning appears and edits remain in memory until the page closes. Reset restores the generated fixture in the current mode. `tools/build-mission-site.py` assembles the static edition in a separate registered hosting checkout; it regenerates the fixture from the public Python generator.

## Five-minute walkthrough

1. In **Dashboard**, choose Platform and Sprint 03. Change the status or search filter, then click the snapshot's **Remaining** or **Blocked** tile to inspect the matching story ledger. Counts and story points have distinct labels.
2. In **Planning & Hygiene**, lower capacity or add a fictional story to Sprint 03. Inspect its all-sprint outcome delta against the captured baseline. Open **Readiness Quality**, fill demo flags, and see the shared model update.
3. In **Forecasting & Risk**, change added scope or the throughput multiplier and run 2,000 trials. Inspect P50/P80/P95 working days and the stated assumptions.
4. Compare **Dependencies** with **Gantt**. Both use the same modeled finish-to-start schedule, including required upstream outcomes across team boundaries.
5. Use **Assistant** to ask about blocked work or capacity. Review the cited story keys and planning evidence. In **Operations**, change the recorded-age threshold and download the resulting triage queue.
6. Create or edit a **Product Review**, inspect **Platform Metrics** validation results, and export a scoped overview from **Data Sources**. Download Markdown or CSV from **Reports & Analysis**. Reset the sandbox to reproduce the starting state.

## Delivered views

The twelve primary tabs are Dashboard, Planning & Hygiene, Reports & Analysis, Gantt, Forecasting & Risk, Contributors, Dependencies, Product Reviews, Assistant, Operations, Platform Metrics, and Data Sources. The supporting **Work items** ledger is accessible through its header action and snapshot drilldowns; **Readiness Quality** is a Planning & Hygiene subtab.

Highlights include status/search/Remaining filters, a points-based status donut, editable capacities and statuses, additions against a baseline, a readiness action queue, scenario forecasts, prerequisite-aware schedule bars, a rule-based assistant, configurable age triage, eight scoped record checks, editable reviews, and Markdown/CSV/JSON exports. Header controls reload the current model, display demo status, and adjust workspace zoom. “How to read” sections and inline notes explain metric and filter behavior. See [FEATURE-COVERAGE.md](FEATURE-COVERAGE.md) for the full capability map and gaps.

## Data and model

The fixture contains 144 initial generated stories, four fictional teams, eight outcomes, and three sprints. Generator seed `917` and snapshot date **October 14, 2026** are fixed. No private exports, employer source, real employee records, credentials, or live integrations are included.

- **Scope and completion:** sum story points exactly once; outcome rows organize work without adding points. Completion is done points / selected points. Empty scope returns 0% completion and 100% readiness.
- **Filtering:** team, sprint, workflow status, Remaining, and text search determine the shared story slice. Remaining means every status other than Done. Reviews remain workspace-wide. Contributor history uses the selected teams across all generated sprints; its owner table uses the current story slice.
- **Readiness:** description, acceptance, and estimate-presence flags must all be true. Filling demo fields changes flags, not written requirements or an AI review.
- **Capacity and baseline:** capacity is entered per sprint and scales by the selected sprint count. Baseline deltas compare complete all-sprint totals for the outcomes represented in the selection; status/search filters do not redefine those outcome totals. Scope controls add stories only, to Sprint 03.
- **Forecast:** resample completed points from two generated historical sprints, apply uniform 0.7–1.3 throughput variation and a scenario multiplier, and convert remaining scope to working days. The UI runs 2,000 repeatable trials for the selected team's full Sprint 03 scope, independently of sprint/status/search filters. Python uses `random.Random(33)`; the hosted adapter uses a seeded JavaScript Mulberry32 generator. Both apply the declared model, but exact samples and quantiles can differ between runtimes. This is an uncertainty demonstration, not a calibrated forecast or a causal staffing model.
- **Dependencies and Gantt:** a finish-to-start DAG uses remaining points / modeled daily capacity for duration. Cycles and missing references are rejected. Current filters choose entry outcomes; schedule calculations retain required upstream work and full remaining scope for the selected sprint. Bars are modeled working-day offsets, not calendar commitments or measured delivery history.
- **Risk, age, and burndown:** decision cards flag blockers, over-capacity planning, and readiness gaps without a weighted risk score. Recorded ages and cycle days are generated attributes. Burndown is an illustrated monotone trajectory anchored to current completion, not observed daily telemetry.
- **Assistant and integrity:** the assistant matches four documented topics to deterministic rules over current evidence; it calls no AI service. Platform checks inspect the loaded slice and presence flags, not an upstream database or requirement quality.

## API and tests

Local routes are `GET /api/mission/overview`, `/dependencies`, and `/report`, plus JSON POST requests to `/forecast`, `/capacity`, `/scope`, `/baseline`, `/ticket`, `/hygiene`, `/review`, `/review/delete`, and `/reset` under `/api/mission`. Overview queries accept `team`, `sprint`, `status`, and `q`. Hosted mode provides the corresponding browser-local adapter, rather than network API endpoints.

From the repository root:

```sh
python3 -m unittest discover -s tests -v
node --test tests/test_browser_service.cjs
```

Node is needed only for the browser-adapter test command. Tests cover story-level reconciliation, mutations, reset/persistence, dependency validity, forecast behavior, report scope, and storage failure handling. Cross-runtime tests compare overview and dependency results across **840 team/sprint/status/search combinations**. Forecasts are tested for repeatability, ordered quantiles, and scenario behavior rather than exact equality between different random generators.

## Limits and next validation

There are no external issue-tracker adapters, live data feeds, authentication/roles, calendar invitations, outbound messages, document publishing, distributed workers, or production monitoring. Scope removal/re-estimation, historical baseline snapshots, review conflict detection, and production service-level targets are not implemented. The local audit is a sandbox action list, not an immutable compliance ledger.

No production adoption, customer interviews, business impact, or forecast calibration is claimed. Meaningful next validation would interview delivery leads, compare the decision queues with their workflows, and backtest forecasts on a consented public or generated event series.
